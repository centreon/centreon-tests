import shell from 'shelljs'
import psList from 'ps-list'
import { chownSync, existsSync, createReadStream, rmSync, writeFileSync, writeSync } from 'fs'
import fs from 'fs/promises'
import { ChildProcess } from 'child_process'
import sleep from 'await-sleep';
import path from 'path';
import { strict as assert } from 'assert';
import { SIGHUP } from 'constants';
import readline from 'readline'

export enum BrokerType {
    central = 0,
    rrd = 1,
    module = 2
};
export class Broker {
    private instanceCount : number
    private process : ChildProcess
    private rrdProcess : ChildProcess

    static CENTREON_BROKER_UID = parseInt(shell.exec('id -u centreon-broker'))
    static CENTREON_ENGINE_UID = parseInt(shell.exec('id -u centreon-engine'))
    static CENTREON_ENGINE_GID = parseInt(shell.exec('id -g centreon-engine'))
    static CENTREON_BROKER_CENTRAL_LOGS_PATH = `/var/log/centreon-broker/central-broker-master.log`
    static CENTREON_BROKER_RRD_LOGS_PATH = `/var/log/centreon-broker/central-rrd-master.log`
    static CENTREON_BROKER_MODULE_LOGS_PATH = `/var/log/centreon-broker/central-module-master.log`
    static CENTRON_BROKER_CENTRAL_CONFIG_PATH = `/etc/centreon-broker/central-broker.json`
    static CENTRON_BROKER_RRD_CONFIG_PATH = `/etc/centreon-broker/central-rrd.json`
    static CENTRON_MODULE_CONFIG_PATH = `/etc/centreon-broker/central-module.json`
    static CENTRON_RRD_CONFIG_PATH = `/etc/centreon-broker/central-rrd.json`

    lastMatchingLog : number[];

    constructor(count : number = 2) {
        assert(count == 1 || count == 2)
        this.instanceCount = count
        let d = Math.floor(Date.now() / 1000);
        this.lastMatchingLog = [d, d, d];
    }

    /**
     * this function will start a new centreon broker and rdd process
     * upon completition
     *
     * @returns Promise<Boolean> true if correctly started, else false
     */
    async start() : Promise<boolean> {
        this.process = shell.exec(`/usr/sbin/cbd ${Broker.CENTRON_BROKER_CENTRAL_CONFIG_PATH}`, { async: true, uid: Broker.CENTREON_BROKER_UID })
        if (this.instanceCount == 2)
            this.rrdProcess = shell.exec(`/usr/sbin/cbd ${Broker.CENTRON_BROKER_RRD_CONFIG_PATH}`, { async: true, uid: Broker.CENTREON_BROKER_UID })

        return await this.isRunning(20);
    }


    /**
     * will stop current cbd broker if already running
     *
     * @returns Promise<Boolean> true if correctly stopped, else false
     */
    async stop() : Promise<boolean> {
        if (await this.isRunning(25)) {
            let ret1 = this.process.kill()

            let ret2 = true;
            if (this.instanceCount == 2)
                ret2 = this.rrdProcess.kill()

            return await this.isStopped(25);
        }

        return true;
    }


    /**
     * this function will check the list of all process running in current os
     * to check that the current instance of broker is correctly running or not
     *
     * @param  {boolean=true} expected the expected value, true or false
     * @param  {number=15} seconds number of seconds to wait for process to show in processlist
     * @returns Promise<Boolean>
     */
    async isRunning(seconds : number = 15) : Promise<boolean> {
        let centreonBrokerProcess;
        let centreonRddProcess;

        for (let i = 0; i < seconds * 2; ++i) {
            const processList = await psList();

            centreonBrokerProcess = processList.find((process) => process.pid == this.process.pid);

            if (this.instanceCount == 2)
                centreonRddProcess = processList.find((process) => process.pid == this.rrdProcess.pid);
            else
                centreonRddProcess = true

            if (centreonBrokerProcess && centreonRddProcess)
                return true;

            await sleep(500)
        }

        return false;
    }

    /**
     * this function will check the list of all process running in current os
     * to check that the current instance of broker is correctly running or not
     *
     * @param  {boolean=true} expected the expected value, true or false
     * @param  {number=15} seconds number of seconds to wait for process to show in processlist
     * @returns Promise<Boolean>
     */
    async isStopped(seconds : number = 15) : Promise<boolean> {
        let centreonBrokerProcess;
        let centreonRddProcess;

        for (let i = 0; i < seconds * 2; ++i) {
            const processList = await psList();

            centreonBrokerProcess = processList.find((process) => process.pid == this.process.pid);

            if (this.instanceCount == 2)
                centreonRddProcess = processList.find((process) => process.pid == this.rrdProcess.pid);
            else
                centreonRddProcess = false

            if (!centreonBrokerProcess && !centreonRddProcess)
                return true;

            await sleep(500)
        }

        return false;
    }

    async reload() {
        if (await this.isRunning(5)) {
            if (this.instanceCount == 2)
                this.rrdProcess.kill(SIGHUP);
            this.process.kill(SIGHUP);
        }
    }

    async checkCoredump() : Promise<boolean> {
        let retval;
        const cdList = shell.exec('ps ax').stdout.split('\n')
        retval = cdList.find(line => line.includes('/usr/lib/systemd/systemd-coredump'))

        if (!retval) {
            const cdList = await shell.exec('/usr/bin/coredumpctl').stdout.split('\n')
            if (this.instanceCount == 1)
                retval = cdList.find(line => line.includes('cbd') &&
                    line.includes(this.process.pid + ""));
            else
                retval = cdList.find(line => line.includes('cbd') &&
                    (line.includes(this.process.pid + "") || line.includes(this.rrdProcess.pid + "")));
        }
        if (retval)
            return true;
        else
            return false;
    }

    /**
     * this retrive the current centreon config
     *
     * @returns Promise<JSON> config json object
     */
    static async getConfig() : Promise<JSON> {
        return JSON.parse((await fs.readFile('/etc/centreon-broker/central-broker.json')).toString());
    }

    /**
     * this retrive the current centreon module config
     *
     * @returns Promise<JSON> config json object
     */
    static async getConfigCentralModule() : Promise<JSON> {
        return JSON.parse((await fs.readFile('/etc/centreon-broker/central-module.json')).toString());
    }

    static async getConfigCentralRrd() : Promise<JSON> {
        return JSON.parse((await fs.readFile('/etc/centreon-broker/central-rrd.json')).toString());
    }


    /**
     * write json config to centreon default config file location
     * @param  {JSON} config object representing broker configuration
     */
    static async writeConfig(config : JSON) {
        await fs.writeFile('/etc/centreon-broker/central-broker.json', JSON.stringify(config, null, '\t'))
    }

    /**
     * write json config to centreon module config file location
     * @param  {JSON} config object representing broker configuration
     */
    static async writeConfigCentralModule(config : JSON) {
        await fs.writeFile('/etc/centreon-broker/central-module.json', JSON.stringify(config, null, '\t'))
    }

    /**
     * write json config to centreon rrd config file location
     * @param  {JSON} config object representing broker configuration
     */
    static async writeConfigCentralRrd(config : JSON) {
        await fs.writeFile('/etc/centreon-broker/central-rrd.json', JSON.stringify(config, null, '\t'))
    }


    /**
     * this reset the default configuration for broker</Boolean>
     * very useful for resetting after doing some tests
     */
    static resetConfig() {
        return shell.cp(path.join(__dirname, '../config/centreon-broker.json'), Broker.CENTRON_BROKER_CENTRAL_CONFIG_PATH)
    }

    /**
     * this reset the central module configuration for broker</Boolean>
     * very useful for resetting after doing some tests
     */
    static resetConfigCentralModule() {
        return shell.cp(path.join(__dirname, '../config/central-module.json'), Broker.CENTRON_MODULE_CONFIG_PATH)
    }

    /**
     * this reset the central rrd configuration for broker</Boolean>
     * very useful for resetting after doing some tests
     */
    static resetConfigCentralRrd() {
        return shell.cp(path.join(__dirname, '../config/central-rrd.json'), Broker.CENTRON_RRD_CONFIG_PATH)
    }

    /**
     *  this function is useful for checking that a log file contain some string
     * @param  {Array<string>} strings list of string to check, every string in this array must be found in logs file
     * @param  {number} seconds=15 number of second to wait before returning
     * @returns {Promise<Boolean>} true if found, else false
     */
    async checkLogFileContains(b : BrokerType, strings : string[], seconds : number) : Promise<boolean> {
        let logname : string;
        switch (b) {
            case BrokerType.central:
                logname = Broker.CENTREON_BROKER_CENTRAL_LOGS_PATH;
                break;
            case BrokerType.module:
                logname = Broker.CENTREON_BROKER_MODULE_LOGS_PATH;
                break;
            case BrokerType.rrd:
                logname = Broker.CENTREON_BROKER_RRD_LOGS_PATH;
                break;
        }

        while (seconds > 0 && !existsSync(logname)) {
            sleep(1000);
            seconds--;
        }

        let from = this.lastMatchingLog[b];

        /* 3 possible values:
          * 0 => failed
          * 1 => succeed
          * 2 => start again (the file reached its end without success).
          */
        let retval : Promise<number>;

        do {
            let p = new Promise((resolve, reject) => {
                const rl = readline.createInterface({
                    input: createReadStream(logname),
                    terminal: false
                });
                rl.on('line', line => {
                    let d = line.substring(1, 24);
                    let dd = Date.parse(d) / 1000;
                    if (dd >= from) {
                        let idx = strings.findIndex(s => line.includes(s));
                        if (idx >= 0) {
                            this.lastMatchingLog[b] = dd;
                            strings.splice(idx, 1);
                            if (strings.length === 0) {
                                resolve(true);
                                return;
                            }
                        }
                        if (dd - from > seconds) {
                            reject(`Cannot find strings <<${strings.join(', ')}>> in centengine.log`);
                            return;
                        }
                    }
                });
                rl.on('close', () => {
                    reject('File closed');
                })
            });

            retval = p.then((value : boolean) => {
                if (!value) {
                    console.log(`Cannot find strings <<${strings.join(', ')}>> in broker logs`);
                    return 0;
                }
                else
                    return 1;
            }).catch(err => {
                if (err == 'File closed')
                    return 2;
                else {
                    console.log(`Cannot find strings <<${strings.join(', ')}>> in broker logs`);
                    return 0;
                }
            });
        } while ((await retval) == 2);
        return (await retval) > 0;
    }

    async checkCentralLogContains(strings : string[], seconds : number = 15) : Promise<boolean> {
        return this.checkLogFileContains(BrokerType.central, strings, seconds);
    }

    async checkRrdLogContains(strings : string[], seconds : number = 15) : Promise<boolean> {
        return this.checkLogFileContains(BrokerType.rrd, strings, seconds);
    }

    async checkModuleLogContains(strings : string[], seconds : number = 15) : Promise<boolean> {
        return this.checkLogFileContains(BrokerType.module, strings, seconds);
    }

    static clearLogs(type : BrokerType) : void {
        let logname : string;
        let uid : number;
        switch (type) {
            case BrokerType.central:
                logname = Broker.CENTREON_BROKER_CENTRAL_LOGS_PATH;
                uid = Broker.CENTREON_BROKER_UID;
                break;
                case BrokerType.module:
                    logname = Broker.CENTREON_BROKER_MODULE_LOGS_PATH;
                    uid = Broker.CENTREON_ENGINE_UID;
                    break;
                    case BrokerType.rrd:
                        logname = Broker.CENTREON_BROKER_RRD_LOGS_PATH;
                        uid = Broker.CENTREON_ENGINE_UID;
                        break;
        
            }
        if (existsSync(logname)) {
            rmSync(logname);
            writeFileSync(logname, '');
            chownSync(logname, uid, uid);
        }
    }

    static clearLogsCentralModule() : void {
        if (existsSync(Broker.CENTREON_BROKER_CENTRAL_LOGS_PATH))
            rmSync(Broker.CENTREON_BROKER_CENTRAL_LOGS_PATH);
        if (existsSync(Broker.CENTREON_BROKER_RRD_LOGS_PATH))
            rmSync(Broker.CENTREON_BROKER_RRD_LOGS_PATH);
        if (existsSync(Broker.CENTREON_BROKER_MODULE_LOGS_PATH))
            rmSync(Broker.CENTREON_BROKER_MODULE_LOGS_PATH);
    }

    static async isMySqlRunning() : Promise<Boolean> {
        const cdList = shell.exec('systemctl status mysql').stdout.split('\n')
        let retval;
        retval = cdList.find(line => line.includes('inactive'))
        if (retval)
            return true
        else
            return false
    }

    /**
     *  this function checks if instances of cbd are actually running
     * @param  {void} 
     * @returns {Promise<Boolean>} true if found, else false
     */
    static isServiceRunning() : boolean {
        /* checks if we have an active systemctl status */
        const cdList = shell.exec('systemctl status cbd').stdout.split('\n')
        if (cdList.find(line => line.includes('running')))
            return true;
        else
            return false;
    }

    /**
     *  this function checks if instances of cbd are actually running
     * @param  {void} 
     * @returns {Boolean} true if found, else false
     */
    static isInstancesRunning() : boolean {
        let instances = shell.exec('ps ax |grep -v grep | grep "/sbin/cbd"').stdout.split('\n')

        instances = instances.filter(String)

        if (instances != undefined && instances.length)
            return true;
        else
            return false;
    }

    /**
     *  this function close instances of cbd that are actually running
     * @param  {void} 
     * @returns {void} true if found, else false
     */
    static async closeInstances() : Promise<void> {
        const processList = await psList();
        processList.forEach(process => {
            if (process.name == 'cbd')
                shell.exec(`kill -9 ${process.pid}`);
        });
    }

    static async cleanAllInstances() : Promise<void> {
        /* close cbd if running */
        if (Broker.isServiceRunning())
            shell.exec('systemctl stop cbd')

        /* closes instances of cbd if running */
        if (Broker.isInstancesRunning()) {
            await Broker.closeInstances()
        }
    }
}
