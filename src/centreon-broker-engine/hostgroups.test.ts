import shell from 'shelljs';
import { Broker, BrokerType } from '../core/broker';
import { Engine } from '../core/engine';
import { isBrokerAndEngineConnected } from '../core/brokerEngine';

shell.config.silent = true;

describe('engine reloads with new hosts and hostgroups configurations', () => {

    beforeEach(async () => {
        await Engine.cleanAllInstances();
        await Broker.cleanAllInstances();

        Broker.clearLogs(BrokerType.central);
        Broker.resetConfig();
        Engine.clearLogs();

        if (Broker.isInstancesRunning() || Engine.isRunning()) {
            console.log("program could not stop cbd or centengine")
            process.exit(1)
        }
    })

    afterAll(() => {
        beforeEach(async () => {
            await Engine.cleanAllInstances();
            await Broker.cleanAllInstances();
        })
    })

    it('New host group', async () => {
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

        let hostnames : string[] = ['host_1', 'host_2'];
        let logs : string[] = [];

        for (let i = 0; i < 50; i++) {
            let host = await engine.addHost();
            hostnames.push(host.name);
            let group = await engine.addHostgroup(i + 2, hostnames);
            logs.push(`SQL: enabling membership of host ${host.id} to host group ${group.id} on instance 1`);
            logs.push(`SQL: processing host event (poller: 1, host: ${host.id}, name: ${host.name}`);
        }
        console.log("50 new hosts and 50 new hostgroups");

        p = [engine.reload(), broker.reload()];
        await Promise.all(p);
        console.log("Engine and Broker reloaded");
        await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();
        console.log("Engine and Broker connected");

        await expect(broker.checkCentralLogContains(logs, 60)).resolves.toBeTruthy();
        console.log("Broker log contains all needed data");
    }, 120000);
});
