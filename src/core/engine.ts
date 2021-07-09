
import sleep from 'await-sleep'
import { ChildProcess } from 'child_process'
import { existsSync, mkdir, open, rmSync, write, writeFileSync } from 'fs'
import psList from 'ps-list'
import shell from 'shelljs'

export class Engine {
    private process : ChildProcess
    private config : JSON;
    static CENTREON_ENGINE_UID = parseInt(shell.exec('id -u centreon-engine'))
    static CENTRON_ENGINE_CONFIG_PATH = `/etc/centreon-engine/centengine.cfg`

    constructor() {}

    /**
     * this function will start a new centreon engine
     * upon completition
     *
     * @returns Promise<Boolean> true if correctly started, else false
     */
    async start() {
        this.process = shell.exec(`/usr/sbin/centengine ${Engine.CENTRON_ENGINE_CONFIG_PATH}`, { async: true, uid: Engine.CENTREON_ENGINE_UID })

        const isRunning = await this.isRunning(true, 20)
        return isRunning;
    }


    /**
     * will stop current engine instance if already running
     *
     * @returns Promise<Boolean> true if correctly stoped, else false
     */
    async stop() {
        if (await this.isRunning(true, 5)) {
            this.process.kill()
            const isRunning = await this.isRunning(false)
            return !isRunning;
        }

        return true;
    }

    async checkCoredump() : Promise<boolean> {
        const cdList = shell.exec('/usr/bin/coredumpctl').stdout.split('\n')
        let retval: string;
        retval = cdList.find(line => line.includes('cbd') &&
            line.includes(this.process.pid + ''));
        if (retval)
            return true;
        else
            return false;
    }

    /**
      * this function will check the list of all process running in current os
      * to check that the current instance of engine is correctly running or not
      *
      * @param  {boolean=true} expected the expected value, true or false
      * @param  {number=15} seconds number of seconds to wait for process to show in processlist
      * @returns Promise<Boolean>
      */
    async isRunning(expected : boolean = true, seconds : number = 15) : Promise<boolean> {
        let centreonEngineProcess: psList.ProcessDescriptor;

        for (let i = 0; i < seconds * 2; ++i) {

            const processList = await psList();
            centreonEngineProcess = processList.find((process) => process.pid == this.process.pid);

            if (centreonEngineProcess && expected)
                return true;

            else if (!centreonEngineProcess && !expect)
                return false;

            await sleep(500)
        }

        return !!centreonEngineProcess;
    }

    /**
     * Create a host configuration for the host of the given id.
     *
     * @param id id of the host to create.
     * @returns a string containing the host specification formatted as needed in a cfg file.
     */
    static createHost(id : number) : string {
        let a = id % 255;
        let q = Math.floor(id / 255);
        let b = q % 255;
        q = Math.floor(q / 255);
        let c = q % 255;
        q = Math.floor(q / 255);
        let d = q % 255;

        let retval = `define host {
    host_name                      host_${id}
    alias                          host_${id}
    address                        ${a}.${b}.${c}.${d}
    check_command                  command_1
    check_period                   24x7
    register                       1
    _KEY${id}                      VAL${id}
    _SNMPCOMMUNITY                 public
    _SNMPVERSION                   2c
    _HOST_ID                       ${id}
}
`;
        return retval;
    }

    /**
     * create a command configuration for the command of the given id.
     * @param commandId The id of the command to create.
     * @returns A string containing the command configuration to be stored in a cfg file.
     */
    static createCommand(commandId : number) : string {
        if (commandId % 2 == 0) {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    /var/lib/centreon-engine/check.pl ${commandId}
    connector                       Perl Connector
}
`;
            return retval
        }
        else {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    /var/lib/centreon-engine/check.pl ${commandId}
}
`;
            return retval
        }
    }

    /**
     * Create the connectors configuration.
     * 
     * @returns A string with the connectors configuration.
     */
    static createConnectors() : string {
        return `define connector {
    connector_name Perl Connector
    connector_line /usr/lib64/centreon-connector/centreon_connector_perl
}

define connector {
    connector_name SSH Connector
    connector_line /usr/lib64/centreon-connector/centreon_connector_ssh
}
`;
    }

    /**
     * create a service configuration for the given host id, service is and knowning that we have nbCommands commands.
     * @param hostId: Id of the host attached to this service.
     * @param serviceId: Id of the service to create.
     * @returns A string containing the service configuration to be stored in a cfg file.
     */
    static createService(hostId : number, serviceId : number, nbCommands : number) : string {
        let commandId = ((hostId + 1) * (serviceId + 1)) % nbCommands;
        let retval = `define service {
    host_name                       host_${hostId}
    service_description             service_${serviceId}
    _SERVICE_ID                     ${serviceId}
    check_command                   command_${commandId}
    max_check_attempts              3
    check_interval                  5
    retry_interval                  5
    register                        1
    active_checks_enabled           1
    passive_checks_enabled          1
}
`
        return retval;
    }

    /**
     * Create all the cfg files needed for engine given several parameters.
     * @param hosts Number of hosts to create.
     * @param servicesByHost  Number of services by host.
     * @param nbCommands Number of commands in the configuration.
     * @returns True on success.
     */
    static async buildConfig(hosts : number = 50, servicesByHost : number = 20, nbCommands : number = 50) : Promise<boolean> {
        let configDir = process.cwd() + '/src/config/centreon-engine';
        if (existsSync(configDir)) {
            rmSync(configDir, { recursive: true });
        }

        let cfg = '';
        let p = new Promise((resolve, reject) => {
            let contacts = [ { 'contact_name': 'User1', 'alias': 'user1' }, { 'contact_name': 'User2', 'alias': 'user2' }, { 'contact_name': 'admin_admin', 'alias': 'admin' }]
            // 1 for resource.cfg + 1 for notification command + 1 for connectors
            let count = hosts + hosts * servicesByHost + nbCommands + contacts.length + 1 + 1 + 1;
            mkdir(configDir, () => {
                open(configDir + '/resource.cfg', 'w', (err, fd) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    write(fd, Buffer.from("$USER1$=/usr/lib64/nagios/plugins\n$CENTREONPLUGINS$=/usr/lib/centreon/plugins/\n"), (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        --count;
                        if (count <= 0) {
                            resolve(true);
                            return;
                        }
                    });
                });
                open(configDir + '/hosts.cfg', 'w', (err, fd) => {
                    cfg += 'cfg_file=/etc/centreon-engine/hosts.cfg\n';
                    if (err) {
                        reject(err);
                        return;
                    }
                    cfg += 'cfg_file=/etc/centreon-engine/services.cfg\n';
                    for (let i = 1; i <= hosts; ++i) {
                        write(fd, Buffer.from(Engine.createHost(i)), (err) => {
                            --count;    // one host written
                            if (count <= 0) {
                                resolve(true);
                                return;
                            }

                            if (err) {
                                reject(err);
                                return;
                            }

                            open(configDir + '/services.cfg', 'a', (err, fd) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                for (let j = 1; j <= servicesByHost; ++j) {
                                    write(fd, Buffer.from(Engine.createService(i, j, nbCommands)), (err) => {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }
                                        --count;    // One service written
                                        if (count <= 0) {
                                            resolve(true);
                                            return;
                                        }
                                    });
                                }
                            });
                        });
                    }
                    open(configDir + '/commands.cfg', 'w', (err, fd) => {
                        cfg += 'cfg_file=/etc/centreon-engine/commands.cfg\n';
                        if (err) {
                            reject(err);
                            return;
                        }
                        write(fd, Buffer.from("define command {\n    command_name    notif\n    command_line    /bin/sh -c 'echo \"NOTIFICATION $CONTACTNAMEHORNAME$\" >> /tmp/notifications'\n}\n"), err => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            --count;    // One command written
                            if (count <= 0) {
                                resolve(true);
                                return;
                            }
                        })
                        for (let i = 1; i <= nbCommands; ++i) {
                            write(fd, Buffer.from(Engine.createCommand(i)), (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                --count;    // One command written
                                if (count <= 0) {
                                    resolve(true);
                                    return;
                                }
                            });
                        }
                    });
                    open(configDir + '/contacts.cfg', 'w', (err, fd) => {
                        cfg += 'cfg_file=/etc/centreon-engine/contacts.cfg\n';
                        if (err) {
                            reject(err);
                            return;
                        }
                        contacts.forEach(c => {
                            write(fd, Buffer.from(Engine.createContact(c)), (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                --count;
                                if (count <= 0) {
                                    resolve(true);
                                    return;
                                }
                            });
                        });
                    });
                    open(configDir + '/connectors.cfg', 'w', (err, fd) => {
                        cfg += 'cfg_file=/etc/centreon-engine/connectors.cfg\n';
                        if (err) {
                            reject(err);
                            return;
                        }
                        write(fd, Buffer.from(Engine.createConnectors()), err => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            --count;
                            if (count <= 0) {
                                resolve(true);
                                return;
                            }
                        });
                    });
                });
                if (count <= 0)
                    resolve(true);
            });
        });

        let retval = p.then(ok => {
            writeFileSync(configDir + '/centengine.cfg', Buffer.from(`${cfg}broker_module=/usr/lib64/centreon-engine/externalcmd.so
broker_module=/usr/lib64/nagios/cbmod.so /etc/centreon-broker/central-module.json
interval_length=60
use_timezone=:Europe/Paris
resource_file=/etc/centreon-engine/resource.cfg
log_file=/var/log/centreon-engine/centengine.log
status_file=/var/log/centreon-engine/status.dat
command_check_interval=1s
command_file=/var/lib/centreon-engine/rw/centengine.cmd
state_retention_file=/var/log/centreon-engine/retention.dat
retention_update_interval=60
sleep_time=0.2
service_inter_check_delay_method=s
service_interleave_factor=s
max_concurrent_checks=400
max_service_check_spread=5
check_result_reaper_frequency=5
low_service_flap_threshold=25.0
high_service_flap_threshold=50.0
low_host_flap_threshold=25.0
high_host_flap_threshold=50.0
service_check_timeout=10
host_check_timeout=12
event_handler_timeout=30
notification_timeout=30
ocsp_timeout=5
ochp_timeout=5
perfdata_timeout=5
date_format=euro
illegal_object_name_chars=~!$%^&*"|'<>?,()=
illegal_macro_output_chars=\`~$^&"|'<>
admin_email=admin@localhost
admin_pager=admin
event_broker_options=-1
cached_host_check_horizon=60
debug_file=/var/log/centreon-engine/centengine.debug
debug_level=272
debug_verbosity=2
log_pid=1
enable_macros_filter=0
grpc_port=50001
postpone_notification_to_timeperiod=0
instance_heartbeat_interval=30
enable_notifications=1
execute_service_checks=1
accept_passive_service_checks=1
enable_event_handlers=1
check_external_commands=1
use_retained_program_state=1
use_retained_scheduling_info=1
use_syslog=0
log_notifications=1
log_service_retries=1
log_host_retries=1
log_event_handlers=1
log_external_commands=1
soft_state_dependencies=0
obsess_over_services=0
process_performance_data=0
check_for_orphaned_services=0
check_for_orphaned_hosts=0
check_service_freshness=1
enable_flap_detection=0
`));
            return true;
        }).catch(err => {
                console.log(err);
                return false
            });
        return retval;
    }

    static createContact(c: { contact_name: string; alias: string }): string {
        return `define contact {
    contact_name                    ${c.contact_name}
    alias                           ${c.alias}
    email                           ${c.alias}@localhost
    host_notification_period        24x7
    service_notification_period     24x7
    host_notification_options       n
    service_notification_options    c,r
    register                        1
    host_notifications_enabled      1
    service_notifications_enabled   1
    host_notification_commands      notif
    service_notification_commands   notif
}
`
    }
}