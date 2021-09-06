import shell from 'shelljs';
import { Broker } from '../core/broker';
import { Engine } from '../core/engine';
import { isBrokerAndEngineConnected } from '../core/brokerEngine';

shell.config.silent = true;

describe('engine and broker testing in same time', () => {

    beforeEach(() => {
        Broker.cleanAllInstances();
        Engine.cleanAllInstances();

        Broker.clearLogs();
        Broker.resetConfig();
        Engine.clearLogs();

        if (Broker.isServiceRunning() || Engine.isRunning()) {
            console.log("program could not stop cbd or centengine")
            process.exit(1)
        }

    })

    afterAll(() => {
        beforeEach(() => {
            Broker.cleanAllInstances();
            Engine.cleanAllInstances();

            Broker.clearLogs()
            Broker.resetConfig()
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
        await engine.start();
        await engine.checkLogFileContains(["Event broker module '/usr/lib64/nagios/cbmod.so' initialized successfully"], 120);

        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect(engine.addHostgroup(1, ['host_1', 'host_2', 'host_3'])).resolves.toBeTruthy();
        await engine.reload();
        await broker.reload();
        await engine.checkLogFileContains(["Event broker module '/usr/lib64/nagios/cbmod.so' initialized successfully"], 120);
        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

        let host_name = await engine.addHost();
        await expect(engine.addHostgroup(2, [host_name])).resolves.toBeTruthy();
        let p = [engine.reload(), broker.reload()];
        await Promise.all(p);
        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

        await expect(broker.checkLogFileContains([
            "SQL: enabling membership of host 3 to host group 1 on instance 1",
            "SQL: enabling membership of host 2 to host group 1 on instance 1",
            "SQL: enabling membership of host 1 to host group 1 on instance 1",
            "SQL: processing host event (poller: 1, host: 51, name: host_51",
            "SQL: enabling membership of host 51 to host group 2 on instance 1"],
            120)).resolves.toBeTruthy();

        await engine.stop();
        await broker.stop();
    }, 300000);
});
