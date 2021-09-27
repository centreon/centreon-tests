import shell from 'shelljs'
import psList from 'ps-list'
import { ChildProcess, exec, spawn, spawnSync } from 'child_process'
import fs from 'fs/promises'
import sleep from 'await-sleep'
import { chownSync, copyFile, copyFileSync, createReadStream, existsSync, mkdir, mkdirSync, open, rmSync, statSync, write } from 'fs'
import { resolve } from 'path/posix'
import { SIGHUP } from 'constants'
import readline from 'readline'

export class Engine {
    hostgroup : number[] = [];
    static lastHostId : number = 0;
    static lastServiceId : number = 0;
    static servicesByHost : number = 50;
    static nbCommands : number = 50;
    static CENTREON_ENGINE_CONFIG_PATH : string[];
    static CENTREON_ENGINE_GID = parseInt(shell.exec('id -g centreon-engine'));
    static CENTREON_ENGINE_UID = parseInt(shell.exec('id -u centreon-engine'));
    CENTRON_ENGINE_CONFIG_PATH = '/etc/centreon-engine/centengine.cfg';
    static CENTREON_ENGINE_HOME = '/var/lib/centreon-engine-tests';
    CENTREON_ENGINE_CONFIG_DIR = '/src/config/centreon-engine';
    static CENTREON_ENGINE_LOGS_PATH = '/var/log/centreon-engine/centengine.log';
    static lastMatchingLog : number[];
    static instanceCount : number;
    processes : ChildProcess[];

    constructor(count : number = 1) {
        Engine.instanceCount = count;
        Engine.lastMatchingLog = new Array(count).map(x => Math.floor(Date.now() / 1000));
        Engine.CENTREON_ENGINE_CONFIG_PATH = new Array(count).map(x => `/etc/centreon-engine/conf${x}/centengine.cfg`);
    }

    /**
     * this function will start a new centreon engine
     * upon completition
     *
     * @returns Promise<Boolean> true if correctly started, else false
     */
    async start() : Promise<boolean> {
        this.processes = [];
        for (let i = 0; i < Engine.instanceCount; i++) {
            mkdirSync(`/var/log/centreon-engine/config${i}/`, { recursive: true });
            chownSync(`/var/log/centreon-engine/config${i}/`, Engine.CENTREON_ENGINE_UID, Engine.CENTREON_ENGINE_GID);
            mkdirSync(`/var/lib/centreon-engine/config${i}/`, { recursive: true });
            chownSync(`/var/lib/centreon-engine/config${i}/`, Engine.CENTREON_ENGINE_UID, Engine.CENTREON_ENGINE_GID);
            mkdirSync(`/var/lib/centreon-engine/config${i}/rw`, { recursive: true });
            chownSync(`/var/lib/centreon-engine/config${i}/rw`, Engine.CENTREON_ENGINE_UID, Engine.CENTREON_ENGINE_GID);
            Engine.lastMatchingLog = new Array(Engine.instanceCount).fill(Math.floor(Date.now() / 1000));
            this.processes.push(shell.exec(`/usr/sbin/centengine /etc/centreon-engine/config${i}/centengine.cfg`, { async: true, uid: Engine.CENTREON_ENGINE_UID }));
        }
        return await this.isRunning(20);
    }


    /**
     * will stop current engine instance if already running
     *
     * @returns Promise<Boolean> true if correctly stopped, else false
     */
    async stop() : Promise<boolean> {
        for (let p of this.processes)
            p.kill();

        return await this.isStopped(25);
    }

    static clearLogs() : void {
        if (existsSync(Engine.CENTREON_ENGINE_LOGS_PATH))
            rmSync(Engine.CENTREON_ENGINE_LOGS_PATH);
    }

    async reload() {
        if (await this.isRunning(5)) {
            for (let p of this.processes)
                p.kill(SIGHUP);
        }
    }

    async checkCoredump() : Promise<boolean> {
        let pids = this.processes.map((value) => {
            return value.pid;
        });
        let retval : string;
        const cdList = shell.exec('ps ax').stdout.split('\n')
        retval = cdList.find(line => line.includes('/usr/lib/systemd/systemd-coredump'))

        if (!retval) {
            const cdList = shell.exec('/usr/bin/coredumpctl').stdout.split('\n')
            retval = cdList.find(line => line.includes('centengine') &&
                pids.some(pid => line.includes(pid + "")));
        }
        if (retval)
            return true;
        else
            return false;
    }

    static isRunning() : boolean {
        const cdList = shell.exec('ps ax | grep -v grep | grep centengine').stdout.split('\n')
        let retval = cdList.find(line => line.includes('/usr/sbin/centengine'));
        if (retval)
            return true;
        else
            return false;
    }

    /**
      * this function will check the list of all process running in current os
      * to check that the current instance of engine is correctly running or not
      *
      * @param  {number=15} seconds number of seconds to wait for process to show in processlist
      * @returns Promise<Boolean>
      */
    async isRunning(seconds : number = 15) : Promise<boolean> {
        let my_processes = Object.assign([], this.processes);
        for (let i = 0; i < seconds * 2; ++i) {
            const processList = await psList();
            my_processes = my_processes.filter(p => !processList.some(pp => pp.pid == p.pid));
            if (my_processes.length == 0)
                return true;
            await sleep(500);
        }
        return false;
    }

    /**
      * this function checks that processes in the list of all processes are stopped.
      *
      * @param  {number=15} seconds number of seconds to wait for process to show in processlist
      * @returns Promise<Boolean>
      */
    async isStopped(seconds : number = 15) : Promise<boolean> {
        let my_processes = Object.assign([], this.processes);
        for (let i = 0; i < seconds * 2; ++i) {
            const processList = await psList();
            my_processes = my_processes.filter(p => processList.some(pp => pp.pid == p.pid));
            if (my_processes.length == 0)
                return true;
            await sleep(500);
        }
        return false;
    }

    /**
    *  this function close instances of cbd that are actually running
    * @param  {void} 
    * @returns {void} true if found, else false
    */
    static async closeInstances() : Promise<void> {
        const processList = await psList();
        processList.forEach((process) => {
            if (process.name == 'centengine')
                shell.exec(`kill -9 ${process.pid}`);
        });
    }

    static async cleanAllInstances() : Promise<void> {
        /* close centengine if running */
        if (Engine.isRunning())
            shell.exec('systemctl stop centengine')

        /* closes instances of centengine if running */
        if (Engine.isRunning()) {
            await Engine.closeInstances()
        }
    }


    static createCentengine(id : number) : string {
        let retval = `#cfg_file=/etc/centreon-engine/config${id}/hostTemplates.cfg
cfg_file=/etc/centreon-engine/config${id}/hosts.cfg
#cfg_file=/etc/centreon-engine/config${id}/serviceTemplates.cfg
cfg_file=/etc/centreon-engine/config${id}/services.cfg
cfg_file=/etc/centreon-engine/config${id}/commands.cfg
#cfg_file=/etc/centreon-engine/config${id}/contactgroups.cfg
#cfg_file=/etc/centreon-engine/config${id}/contacts.cfg
cfg_file=/etc/centreon-engine/config${id}/hostgroups.cfg
#cfg_file=/etc/centreon-engine/config${id}/servicegroups.cfg
cfg_file=/etc/centreon-engine/config${id}/timeperiods.cfg
#cfg_file=/etc/centreon-engine/config${id}/escalations.cfg
#cfg_file=/etc/centreon-engine/config${id}/dependencies.cfg
cfg_file=/etc/centreon-engine/config${id}/connectors.cfg
#cfg_file=/etc/centreon-engine/config${id}/meta_commands.cfg
#cfg_file=/etc/centreon-engine/config${id}/meta_timeperiod.cfg
#cfg_file=/etc/centreon-engine/config${id}/meta_host.cfg
#cfg_file=/etc/centreon-engine/config${id}/meta_services.cfg
broker_module=/usr/lib64/centreon-engine/externalcmd.so
broker_module=/usr/lib64/nagios/cbmod.so /etc/centreon-broker/poller-module.json
interval_length=60
use_timezone=:Europe/Paris
resource_file=/etc/centreon-engine/config${id}/resource.cfg
log_file=/var/log/centreon-engine/config${id}/centengine.log
status_file=/var/log/centreon-engine/config${id}/status.dat
command_check_interval=1s
command_file=/var/lib/centreon-engine/config${id}/rw/centengine.cmd
state_retention_file=/var/log/centreon-engine/config${id}/retention.dat
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
admin_email=titus@bidibule.com
admin_pager=admin
event_broker_options=-1
cached_host_check_horizon=60
debug_file=/var/log/centreon-engine/config${id}/centengine.debug
debug_level=400
debug_verbosity=2
log_pid=1
macros_filter=KEY80,KEY81,KEY82,KEY83,KEY84
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
`;
        return retval;
    }

    /**
     * Create the configuration for a new host.
     * 
     * @returns An object containing the engine configuration for the host and its id.
     */
    static createHost() : { config : string, id : number } {
        Engine.lastHostId++;
        let id = Engine.lastHostId;

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
    check_command                  check
    check_period                   24x7
    register                       1
    _KEY${id}                      VAL${id}
    _SNMPCOMMUNITY                 public                                       
    _SNMPVERSION                   2c                                           
    _HOST_ID                       ${id}
}
`;
        return { config: retval, id: id };
    }

    static createHostgroup(id : number, children : string[]) {
        let members = children.join(',');
        let retval = `define hostgroup {
    hostgroup_id                    ${id}
    hostgroup_name                  hostgroup_${id}
    alias                           hostgroup_${id}
    members                         ${members}
}
`;
        return retval;
    }

    static createCommand(commandId : number) : string {
        if (commandId % 2 == 0) {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    ${Engine.CENTREON_ENGINE_HOME}/${commandId}
    connector                       Perl Connector
}
`;
            return retval
        }
        else {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    ${Engine.CENTREON_ENGINE_HOME}/check.pl ${commandId}
}
`;
            return retval
        }
    }

    static createService(hostId : number, cmdIds : number[]) : string {
        let serviceId = ++Engine.lastServiceId;
        let commandId = cmdIds[0] + Math.floor(Math.random() * (cmdIds[1] - cmdIds[0]));
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

    static async buildConfigs(hosts : number = 50, servicesByHost : number = Engine.servicesByHost) : Promise<boolean> {
        let retval : Promise<boolean>;

        /* Construction of an array by instance with the good number of hosts */
        let hostCounts : number[] = [];
        let v = Math.floor(hosts / Engine.instanceCount);
        let last = hosts - (Engine.instanceCount - 1) * v;
        for (let x = 0; x < Engine.instanceCount - 1; x++)
            hostCounts.push(v);
        hostCounts.push(last);

        for (let inst = 0; inst < Engine.instanceCount; inst++) {
            let hosts = hostCounts[inst];
            let configDir = process.cwd() + `/src/config/centreon-engine/config${inst}`;
            let scriptDir = process.cwd() + '/src/config/scripts';
            if (existsSync(configDir)) {
                rmSync(configDir, { recursive: true });
            }

            let p = new Promise((resolve, reject) => {
                let count = hosts + hosts * servicesByHost + Engine.nbCommands + 1 /* for notification command */ + 1 /* for centengine.cfg */;
                mkdir(configDir, { recursive: true }, () => {
                    open(configDir + '/centengine.cfg', 'w', (err, fd) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        write(fd, Buffer.from(Engine.createCentengine(inst)), (err) => {
                            --count;
                            if (count <= 0) {
                                resolve(true);
                                return;
                            }
                            if (err) {
                                reject(err);
                                return;
                            }
                        });
                    });
                    open(configDir + '/hosts.cfg', 'w', (err, fd) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        for (let i = 1; i <= hosts; ++i) {
                            let h = Engine.createHost();
                            write(fd, Buffer.from(h.config), (err) => {
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
                                        write(fd, Buffer.from(Engine.createService(h.id, [inst * Engine.nbCommands + 1, (inst + 1) * Engine.nbCommands])), (err) => {
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
                            for (let i = inst * this.nbCommands + 1; i <= (inst + 1) * this.nbCommands; ++i) {
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
                            write(fd, Buffer.from(`define command {
    command_name                    notif
    command_line                    ${Engine.CENTREON_ENGINE_HOME}/notif.pl
}
define command {
    command_name                    test-notif
    command_line                    ${Engine.CENTREON_ENGINE_HOME}/notif.pl
}
define command {
    command_name                    check
    command_line                    ${Engine.CENTREON_ENGINE_HOME}/check.pl 0
}
`), (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                            });
                            --count; // one command written
                            if (count <= 0) {
                                resolve(true);
                                return;
                            };
                        });
                    });
                    if (count <= 0)
                        resolve(true);
                });
            });

            retval = p.then(ok => {
                mkdirSync(`/etc/centreon-engine/config${inst}`, { recursive: true });
                for (let f of ['centengine.cfg', 'commands.cfg', 'services.cfg', 'hosts.cfg'])
                    copyFileSync(configDir + '/' + f, `/etc/centreon-engine/config${inst}/` + f);
                const configTestDir = process.cwd() + `/src/config/centreon-engine-config/`;
                for (let f of ['centreon-bam-host.cfg', 'dependencies.cfg', 'meta_services.cfg',
                    'centreon-bam-command.cfg', 'centreon-bam-services.cfg', 'escalations.cfg', 'meta_timeperiod.cfg',
                    'centreon-bam-contactgroups.cfg', 'centreon-bam-timeperiod.cfg', 'hostgroups.cfg', 'resource.cfg',
                    'centreon-bam-contacts.cfg', 'connectors.cfg', 'hostTemplates.cfg', 'servicegroups.cfg',
                    'centreon-bam-dependencies.cfg', 'contactgroups.cfg', 'meta_commands.cfg', 'serviceTemplates.cfg',
                    'centreon-bam-escalations.cfg', 'contacts.cfg', 'meta_host.cfg', 'timeperiods.cfg'])
                    copyFileSync(configTestDir + f, `/etc/centreon-engine/config${inst}/` + f);

                if (!existsSync(Engine.CENTREON_ENGINE_HOME))
                    mkdirSync(Engine.CENTREON_ENGINE_HOME);

                for (let f of ['check.pl', 'notif.pl'])
                    copyFileSync(scriptDir + '/' + f, Engine.CENTREON_ENGINE_HOME + '/' + f)
                return true;
            })
                .catch(err => {
                    console.log(err);
                    return false
                });
        }
        return retval;
    }

    async addHostgroup(index : number, members : string[]) : Promise<{ id : number, members : string[] }> {
        let p = new Promise((resolve, reject) => {
            if (this.hostgroup.indexOf(index) < 0) {
                open(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/hostgroups.cfg', 'a+', (err, fd) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        write(fd, Buffer.from(Engine.createHostgroup(index, members)), (err) => {
                            if (err) {
                                reject(err);
                            }
                            this.hostgroup.push(index);
                            copyFile(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/hostgroups.cfg', '/etc/centreon-engine/hostgroups.cfg', () => {
                                resolve(true);
                            })
                        });
                    }
                });
            }
        });

        let retval = p.then(ok => {
            return { id: index, members: members };
        }).catch(err => {
            console.log(err);
            throw err;
        });
        return retval;
    }

    /**
     * 
     * @param inst The instance concerned by the new host.
     * @returns an object with two attributes, id which is the host id and config which is the string giving the host configuration.
     */
    async addHost(inst: number) : Promise<{ name : string, id : number }> {
        const srcConfig = process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + `/config${inst}/`;
        let p = new Promise((resolve, reject) => {
            open(srcConfig + 'hosts.cfg', 'a+', (err, fd) => {
                if (err) {
                    reject(err);
                }
                else {
                    let h = Engine.createHost();
                    write(fd, Buffer.from(h.config), (err) => {
                        if (err) {
                            reject(err);
                        }
                        open(srcConfig + 'services.cfg', 'a+', (err, fd) => {
                            if (err) {
                                reject(err);
                            }
                            let p = [];
                            for (let j = 1; j <= Engine.servicesByHost; ++j) {
                                p.push(write(fd, Buffer.from(Engine.createService(h.id, [inst * Engine.nbCommands + 1, (inst + 1) * Engine.nbCommands])), (err) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                }));
                            }
                            Promise.all(p);
                            copyFile(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/hosts.cfg', '/etc/centreon-engine/hosts.cfg', () => {
                                copyFile(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/services.cfg', '/etc/centreon-engine/services.cfg', () => {
                                    resolve(h.id);
                                });
                            });
                        });
                    });
                }
            });
        });

        let retval = p.then((index : number) => {
            return { name: "host_" + index, id: index };
        }).catch(err => {
            throw err;
        });
        return retval;
    }

    /*     async getLogs() : Promise<string> {
            return (await fs.readFile(this.CENTREON_ENGINE_LOGS_PATH)).toString();
        }*/

    /**
     *  this function is useful for checking that a log file contain some string
     * @param  {Array<string>} strings list of string to check, every string in this array must be found in logs file
     * @param  {number} seconds=15 number of second to wait before returning
     * @returns {Promise<Boolean>} true if found, else false
     */
    async checkLogFileContains(inst : number, strings : Array<string>, seconds : number = 15) : Promise<boolean> {
        const logFile = `/var/log/centreon-engine/config${inst}/centengine.log`;
        while (seconds > 0 && !existsSync(logFile)) {
            await sleep(1000);
            seconds--;
        }

        let from = Engine.lastMatchingLog[inst];
        /* 3 possible values:
         * 0 => failed
         * 1 => succeed
         * 2 => start again (the file reached its end without success).
         */
        let retval : Promise<number>;

        do {
            let p = new Promise((resolve, reject) => {
                const rl = readline.createInterface({
                    input: createReadStream(logFile),
                    terminal: false
                });
                rl.on('line', line => {
                    let d = line.substring(1);
                    let dd = parseInt(d);
                    if (dd >= from) {
                        let idx = strings.findIndex(s => line.includes(s));
                        if (idx >= 0) {
                            Engine.lastMatchingLog[inst] = dd;
                            strings.splice(idx, 1);
                            if (strings.length === 0) {
                                resolve(true);
                                return;
                            }
                        }
                        if (dd - from > seconds)
                            reject(`Cannot find strings <<${strings.join(', ')}>> in centengine.log`);
                    }
                });
                rl.on('close', () => {
                    reject('File closed');
                })
            });

            retval = p.then((value : boolean) => {
                if (!value) {
                    console.log(`Cannot find strings <<${strings.join(', ')}>> in engine logs`);
                    return 0;
                }
                else
                    return 1;
            })
                .catch(err => {
                    if (err == 'File closed')
                        return 2;
                    else {
                        console.log(`Cannot find strings <<${strings.join(', ')}>> in engine logs`);
                        return 0;
                    }
                });
        } while ((await retval) == 2);
        return (await retval) > 0;
    }
}
