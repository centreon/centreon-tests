import shell from 'shelljs';
import { Broker } from '../core/broker';
import { Engine } from '../core/engine';
import { isBrokerAndEngineConnected } from '../core/brokerEngine';
import sleep from 'await-sleep';

shell.config.silent = true;

describe('engine and broker testing in same time', () => {

    beforeEach(async () => {
        await Engine.cleanAllInstances();
        await Broker.cleanAllInstances();

        Broker.clearLogs();
        Broker.resetConfig();
        Engine.clearLogs();

        if (Broker.isInstancesRunning() || Engine.isRunning()) {
            console.log("program could not stop cbd or centengine")
            process.exit(1)
        }
    })

    afterAll(() => {
        beforeEach(() => {
            Engine.cleanAllInstances();
            Broker.cleanAllInstances();

            Broker.clearLogs();
            Broker.resetConfig();
            Engine.clearLogs();
        })
    })


    it('start/stop centreon broker/engine - broker first', async () => {
        const broker = new Broker(1);
        await expect(broker.start()).resolves.toBeTruthy()

        const engine = new Engine()
        await expect(engine.start()).resolves.toBeTruthy()

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(engine.stop()).resolves.toBeTruthy();
        await expect(engine.start()).resolves.toBeTruthy()

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(engine.stop()).resolves.toBeTruthy();
        await expect(broker.stop()).resolves.toBeTruthy();

        await expect(broker.checkCoredump()).resolves.toBeFalsy()
        await expect(engine.checkCoredump()).resolves.toBeFalsy()

    }, 60000);


    it('start/stop centreon broker/engine - engine first', async () => {
        const engine = new Engine()
        await expect(engine.start()).resolves.toBeTruthy()

        const broker = new Broker(1);
        await expect(broker.start()).resolves.toBeTruthy()

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(broker.stop()).resolves.toBeTruthy();
        await expect(broker.start()).resolves.toBeTruthy()

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(broker.stop()).resolves.toBeTruthy();
        await expect(engine.stop()).resolves.toBeTruthy();

        await expect(broker.checkCoredump()).resolves.toBeFalsy()
        await expect(engine.checkCoredump()).resolves.toBeFalsy()
    }, 60000);

    it('should handle database service stop and start', async () => {
        const broker = new Broker();

        shell.exec('service mysql stop')

        await expect(Broker.isMySqlRunning()).resolves.toBeTruthy()

        await expect(broker.start()).resolves.toBeTruthy()

        const engine = new Engine()
        await expect(engine.start()).resolves.toBeTruthy()

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(broker.checkLogFileContains(['[core] [error] failover: global error: storage: Unable to initialize the storage connection to the database'])).resolves.toBeTruthy()

        await expect(broker.stop()).resolves.toBeTruthy();
        await expect(engine.stop()).resolves.toBeTruthy();

        await expect(broker.checkCoredump()).resolves.toBeFalsy()
        await expect(engine.checkCoredump()).resolves.toBeFalsy()

    }, 60000);

    it.only('New host group', async () => {
        Broker.resetConfig();
        Broker.resetConfigCentralModule();
        Broker.resetConfigCentralRrd();

        const broker = new Broker(2);
        await expect(broker.start()).resolves.toBeTruthy();

        const engine = new Engine();
        expect(await engine.buildConfig()).toBeTruthy();
        expect(await engine.start()).toBeTruthy();
        console.log("engine started");

        await engine.checkLogFileContains(["Event broker module '/usr/lib64/nagios/cbmod.so' initialized successfully"], 120);
        console.log("cbmod loaded");

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()
        console.log("Broker and Engine connected");

        await expect(engine.addHostgroup(1, ['host_1', 'host_2', 'host_3'])).resolves.toBeTruthy();
        console.log("New host group 1");
        let p = [engine.reload(), broker.reload()];
        await Promise.all(p);
        console.log("Engine and broker reloaded");

        await engine.checkLogFileContains(["Event broker module '/usr/lib64/nagios/cbmod.so' initialized successfully"], 120);
        console.log("cbmod module reloaded");
        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();
        console.log("Broker and Engine connected");

        let host_name = await engine.addHost();

        await expect(engine.addHostgroup(2, [host_name, 'host_2', 'host_6'])).resolves.toBeTruthy();
        await expect(engine.addHostgroup(3, [host_name, 'host_1', 'host_4'])).resolves.toBeTruthy();
        console.log("New host groups 2 and 3 with this host and others")
        p = [engine.reload(), broker.reload()];
        await Promise.all(p);
        console.log("Engine and Broker reloaded")
        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();
        console.log("Engine and Broker connected")

        await expect(broker.checkLogFileContains([
            "SQL: enabling membership of host 3 to host group 1 on instance 1",
            "SQL: enabling membership of host 2 to host group 1 on instance 1",
            "SQL: enabling membership of host 1 to host group 1 on instance 1",
            "SQL: processing host event (poller: 1, host: 51, name: host_51",
            "SQL: enabling membership of host 6 to host group 2 on instance 1",
            "SQL: enabling membership of host 2 to host group 2 on instance 1",
            "SQL: enabling membership of host 51 to host group 2 on instance 1",
            "SQL: enabling membership of host 4 to host group 3 on instance 1",
            "SQL: enabling membership of host 1 to host group 3 on instance 1",
            "SQL: enabling membership of host 51 to host group 3 on instance 1"],
            60)).resolves.toBeTruthy();
        console.log("Broker log contains all needed data")

        await sleep(100000);
        await engine.stop();
        console.log("Engine stopped");
        await broker.stop();
        console.log("Broker stopped");
    }, 300000);
});
