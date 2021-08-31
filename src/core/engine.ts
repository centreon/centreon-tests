
import shell from 'shelljs'
import psList from 'ps-list'
import sleep from 'await-sleep'
import { ChildProcess } from 'child_process'
import { copyFileSync, existsSync, mkdir, mkdirSync, open, rmSync, write } from 'fs'

export class Engine {
    private process : ChildProcess;
    static CENTREON_ENGINE_UID = parseInt(shell.exec('id -u centreon-engine'));
    static CENTRON_ENGINE_CONFIG_PATH = '/etc/centreon-engine/centengine.cfg';
    static CENTREON_ENGINE_HOME = '/var/lib/centreon-engine-tests';

    constructor() {

    }

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
        let retval : string;
        const cdList = shell.exec('ps ax').stdout.split('\n')
        retval = cdList.find(line => line.includes('/usr/lib/systemd/systemd-coredump'))

        if (!retval) {
            const cdList = await shell.exec('/usr/bin/coredumpctl').stdout.split('\n')
            retval = cdList.find(line => line.includes('cbd') &&
                line.includes(this.process.pid + ""));
        }
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
        let centreonEngineProcess;

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
     *  this function checks if instances of centengine are actually running
     * @param  {void} 
     * @returns {Promise<Boolean>} true if found, else false
     */
    static isServiceRunning() : Boolean {
        const cdList = shell.exec('systemctl status centengine').stdout.split('\n')
        let retval;
        retval = cdList.find(line => line.includes('running'))
        if (retval)
            return true
        else
            return false
    }

    /**
     *  this function checks if instances of centengine are actually running
     * @param  {void} 
     * @returns {Boolean} true if found, else false
     */
    static isInstancesRunning() : Boolean {
        let instances = shell.exec('ps ax |grep -v grep | grep /usr/sbin/centengine').stdout.split('\n')

        instances = instances.filter(String)

        if (instances != undefined || instances.length == 0)
            return true
        else
            return false
    }

    /**
    *  this function close instances of cbd that are actually running
    * @param  {void} 
    * @returns {void} true if found, else false
    */
    static closeInstances() : void {
        let instances = shell.exec('ps ax |grep -v grep | grep /usr/sbin/centengine').stdout.split('\n')
        instances = instances.filter(String)

        for (let i of instances) {
            let str = i.trim().split(" ", 1)
            let pid = +str
            console.log(i, pid)
            shell.exec('kill -9 ' + pid)
        }
    }

    static cleanAllInstances() : void {
        /* close centengine if running */
        if (Engine.isServiceRunning()) {
            shell.exec('systemctl stop centengine')
        }

        /* closes instances of centengine if running */
        if (Engine.isInstancesRunning()) {
            Engine.closeInstances()
        }

    }


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
    check_command                  check
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

    static createCommand(commandId : number) : string {
        if (commandId % 2 == 0) {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    ${this.CENTREON_ENGINE_HOME}/${commandId}
    connector                       Perl Connector
}
`;
            return retval
        }
        else {
            let retval = `define command {
    command_name                    command_${commandId}
    command_line                    ${this.CENTREON_ENGINE_HOME}/check.pl ${commandId}
}
`;
            return retval
        }
    }

    static createService(hostId : number, serviceId : number, nbCommands : number) : string {
        let commandId = ((hostId + 1) * (serviceId + 1)) % nbCommands + 1;
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

    static async buildConfig(hosts : number = 50, servicesByHost : number = 20) : Promise<boolean> {
        let nbCommands = 50;
        let configDir = process.cwd() + '/src/config/centreon-engine';
        let scriptDir = process.cwd() + '/src/config/scripts';
        if (existsSync(configDir)) {
            rmSync(configDir, { recursive: true });
        }

        let p = new Promise((resolve, reject) => {
            let count = hosts + hosts * servicesByHost + nbCommands + 1 /* for notification command */;
            mkdir(configDir, () => {
                open(configDir + '/hosts.cfg', 'w', (err, fd) => {
                    if (err) {
                        reject(err);
                        return;
                    }
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
                        write(fd, Buffer.from(`define command {
    command_name                    notif
    command_line                    ${this.CENTREON_ENGINE_HOME}/notif.pl
}
define command {
    command_name                    test-notif
    command_line                    ${this.CENTREON_ENGINE_HOME}/notif.pl
}
define command {
    command_name                    check
    command_line                    ${this.CENTREON_ENGINE_HOME}/check.pl 0
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

        let retval = p.then(ok => {
            for (let f of ['commands.cfg', 'services.cfg', 'hosts.cfg'])
                copyFileSync(configDir + '/' + f, '/etc/centreon-engine/' + f);
            const configTestDir = process.cwd() + '/src/config/centreon-engine-config/';
            for (let f of ['centengine.cfg', 'centreon-bam-host.cfg', 'dependencies.cfg', 'meta_services.cfg',
                'centreon-bam-command.cfg', 'centreon-bam-services.cfg', 'escalations.cfg', 'meta_timeperiod.cfg',
                'centreon-bam-contactgroups.cfg', 'centreon-bam-timeperiod.cfg', 'hostgroups.cfg', 'resource.cfg',
                'centreon-bam-contacts.cfg', 'connectors.cfg', 'hostTemplates.cfg', 'servicegroups.cfg',
                'centreon-bam-dependencies.cfg', 'contactgroups.cfg', 'meta_commands.cfg', 'serviceTemplates.cfg',
                'centreon-bam-escalations.cfg', 'contacts.cfg', 'meta_host.cfg', 'timeperiods.cfg'])
                copyFileSync(configTestDir + f, '/etc/centreon-engine/' + f);

            if (!existsSync(this.CENTREON_ENGINE_HOME))
                mkdirSync(this.CENTREON_ENGINE_HOME);

            for (let f of ['check.pl', 'notif.pl'])
                copyFileSync(scriptDir + '/' + f, this.CENTREON_ENGINE_HOME + '/' + f)
            return true;
        })
            .catch(err => {
                console.log(err);
                return false
            });
        return retval;
    }
}
