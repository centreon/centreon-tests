
import shell from 'shelljs'
import psList from 'ps-list'
import fs from 'fs/promises'
import sleep from 'await-sleep'
import { ChildProcess } from 'child_process'
import { copyFile, copyFileSync, createReadStream, existsSync, mkdir, mkdirSync, open, rmSync, write } from 'fs'
import { resolve } from 'path/posix'
import { SIGHUP } from 'constants'
import readline from 'readline'

export class Engine {
    hostgroup : number[] = [];
    last_host_id : number = 0;
    servicesByHost : number = 50;
    nbCommands : number = 50;
    static CENTREON_ENGINE_GID = parseInt(shell.exec('id -g centreon-engine'));
    static CENTREON_ENGINE_UID = parseInt(shell.exec('id -u centreon-engine'));
    CENTRON_ENGINE_CONFIG_PATH = '/etc/centreon-engine/centengine.cfg';
    CENTREON_ENGINE_HOME = '/var/lib/centreon-engine-tests';
    CENTREON_ENGINE_CONFIG_DIR = '/src/config/centreon-engine';
    static CENTREON_ENGINE_LOGS_PATH = '/var/log/centreon-engine/centengine.log';
    lastMatchingLog : number;
    pid : number = 0;

    constructor() {
        this.lastMatchingLog = Math.floor(Date.now() / 1000);
    }

    /**
     * this function will start a new centreon engine
     * upon completition
     *
     * @returns Promise<Boolean> true if correctly started, else false
     */
    async start() : Promise<boolean> {
        shell.exec('/usr/bin/systemctl start centengine');

        let retval = await this.isRunning(20);
        return retval;
    }


    /**
     * will stop current engine instance if already running
     *
     * @returns Promise<Boolean> true if correctly stopped, else false
     */
    async stop() : Promise<boolean> {
        if (await this.isRunning(5)) {
            shell.exec('systemctl stop centengine');
        }

        return true;
    }

    static clearLogs() : void {
        if (existsSync(Engine.CENTREON_ENGINE_LOGS_PATH))
            rmSync(Engine.CENTREON_ENGINE_LOGS_PATH);
    }

    async reload() {
        if (await this.isRunning(5)) {
            shell.exec('/usr/bin/systemctl reload centengine');
        }
    }

    async checkCoredump() : Promise<boolean> {
        let retval : string;
        const cdList = shell.exec('ps ax').stdout.split('\n')
        retval = cdList.find(line => line.includes('/usr/lib/systemd/systemd-coredump'))

        if (!retval) {
            const cdList = shell.exec('/usr/bin/coredumpctl').stdout.split('\n')
            retval = cdList.find(line => line.includes('cbd') &&
                line.includes(this.pid + ""));
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
        for (let i = 0; i < seconds * 2; ++i) {
            const processList = await psList();
            let process = processList.find((process) => process.name == 'centengine');

            if (process) {
                if (this.pid == 0)
                    this.pid = process.pid;
                return true;
            }
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


    createHost(id : number) : string {
        if (id > this.last_host_id)
            this.last_host_id = id;

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

    createCommand(commandId : number) : string {
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

    createService(hostId : number, serviceId : number, nbCommands : number) : string {
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

    async buildConfig(hosts : number = 50, servicesByHost : number = this.servicesByHost) : Promise<boolean> {
        let configDir = process.cwd() + '/src/config/centreon-engine';
        let scriptDir = process.cwd() + '/src/config/scripts';
        if (existsSync(configDir)) {
            rmSync(configDir, { recursive: true });
        }

        let p = new Promise((resolve, reject) => {
            let count = hosts + hosts * servicesByHost + this.nbCommands + 1 /* for notification command */;
            mkdir(configDir, () => {
                open(configDir + '/hosts.cfg', 'w', (err, fd) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    for (let i = 1; i <= hosts; ++i) {
                        write(fd, Buffer.from(this.createHost(i)), (err) => {
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
                                    write(fd, Buffer.from(this.createService(i, j, this.nbCommands)), (err) => {
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
                        for (let i = 1; i <= this.nbCommands; ++i) {
                            write(fd, Buffer.from(this.createCommand(i)), (err) => {
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

    async addHostgroup(index : number, members : string[]) : Promise<boolean> {
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
            return true;
        }).catch(err => {
            console.log(err);
            return false;
        });
        return retval;
    }

    async addHost() : Promise<string> {
        let p = new Promise((resolve, reject) => {
            let index = this.last_host_id + 1;
            open(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/hosts.cfg', 'a+', (err, fd) => {
                if (err) {
                    reject(err);
                }
                else {
                    write(fd, Buffer.from(this.createHost(index)), (err) => {
                        if (err) {
                            reject(err);
                        }
                        open(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/services.cfg', 'a', (err, fd) => {
                            if (err) {
                                reject(err);
                            }
                            let p = [];
                            for (let j = 1; j <= this.servicesByHost; ++j) {
                                p.push(write(fd, Buffer.from(this.createService(index, j, this.nbCommands)), (err) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                }));
                            }
                            Promise.all(p);
                            copyFile(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/hosts.cfg', '/etc/centreon-engine/hosts.cfg', () => {
                                copyFile(process.cwd() + this.CENTREON_ENGINE_CONFIG_DIR + '/services.cfg', '/etc/centreon-engine/services.cfg', () => {
                                    resolve(index);
                                });
                            });
                        });
                    });
                }
            });
        });

        let retval = p.then(index => {
            return "host_" + index;
        }).catch(err => {
            console.log(err);
            return "";
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
    async checkLogFileContains(strings : Array<string>, seconds : number = 15) : Promise<boolean> {
        while (seconds > 0 && !existsSync(Engine.CENTREON_ENGINE_LOGS_PATH)) {
            await sleep(1000);
            seconds--;
        }

        let from = this.lastMatchingLog;
        /* 3 possible values:
         * 0 => failed
         * 1 => succeed
         * 2 => start again (the file reached its end without success).
         */
        let retval : Promise<number>;

        do {
            let p = new Promise((resolve, reject) => {
                const rl = readline.createInterface({
                    input: createReadStream(Engine.CENTREON_ENGINE_LOGS_PATH),
                    terminal: false
                });
                rl.on('line', line => {
                    let d = line.substring(1);
                    let dd = parseInt(d);
                    if (dd >= from) {
                        let idx = strings.findIndex(s => line.includes(s));
                        if (idx >= 0) {
                            this.lastMatchingLog = dd;
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
