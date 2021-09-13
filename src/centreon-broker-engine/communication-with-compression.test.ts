import shell from 'shelljs';
import { once } from 'events'
import { Broker, BrokerType } from '../core/broker';
import { Engine } from '../core/engine';
import { isBrokerAndEngineConnected } from '../core/brokerEngine';
import { broker } from 'shared';


shell.config.silent = true;

describe('engine and broker testing in same time for compression', () => {

    beforeEach(() => {
        Broker.cleanAllInstances();
        Engine.cleanAllInstances();

        Broker.clearLogs(BrokerType.central);
        Broker.clearLogs(BrokerType.module);
        Broker.resetConfig(BrokerType.central);
        Broker.resetConfig(BrokerType.module);

        if (Broker.isServiceRunning() || Engine.isRunning()) {
            console.log("program could not stop cbd or centengine")
            process.exit(1)
        }

    })

    afterAll(() => {
        beforeEach(() => {
            Broker.cleanAllInstances();
            Engine.cleanAllInstances();

            Broker.clearLogs(BrokerType.central);
            Broker.resetConfig(BrokerType.central);
            Broker.resetConfig(BrokerType.module);
        })
    })

    it.only('compression checks between broker - engine', async () => {
        const broker = new Broker()
        const engine = new Engine()

        let compression = {
            yes: 'COMPRESSION',
            no: '',
            auto: 'COMPRESSION'
        }

        const config_broker = await Broker.getConfig(BrokerType.central);
        const config_module = await Broker.getConfig(BrokerType.module);

        const centralModuleLoggers = config_module['centreonBroker']['log']['loggers']
        const centralBrokerLoggers = config_broker['centreonBroker']['log']['loggers']

        centralModuleLoggers['bbdo'] = 'info';
        centralBrokerLoggers['bbdo'] = 'info';

        const centralModuleMaster = config_module['centreonBroker']['output'].find((
            output => output.name === 'central-module-master-output'));
        centralModuleMaster['tls'] = 'no';
        const centralBrokerMaster = config_broker['centreonBroker']['input'].find((
            input => input.name === 'central-broker-master-input'))
        centralBrokerMaster['tls'] = 'no';

        for (let c1 in compression) {
            for (let c2 in compression) {
                Broker.clearLogs(BrokerType.central);
                Broker.clearLogs(BrokerType.module);

                // Central
                centralBrokerMaster['compression'] = c1;

                // Module
                centralModuleMaster['compression'] = c2;

                // Central
                let central : string[] = [`[bbdo] [info] BBDO: we have extensions '${compression[c1]}' and peer has '${compression[c2]}'`];

                // Module
                let module : string[] = [`[bbdo] [info] BBDO: we have extensions '${compression[c2]}' and peer has '${compression[c1]}'`];

                if (c1 == 'yes' && c2 == 'no')
                    central.push("[bbdo] [error] BBDO: extension 'COMPRESSION' is set to 'yes' in the configuration but cannot be activated because of peer configuration.");
                else if (c1 == 'no' && c2 == 'yes')
                    module.push("[bbdo] [error] BBDO: extension 'COMPRESSION' is set to 'yes' in the configuration but cannot be activated because of peer configuration.");

                console.log(centralBrokerMaster)
                console.log(centralModuleMaster)

                await Broker.writeConfig(BrokerType.central, config_broker);
                await Broker.writeConfig(BrokerType.module, config_module);

                await expect(broker.start()).resolves.toBeTruthy()
                await expect(engine.start()).resolves.toBeTruthy()

                await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy()

                await expect(broker.checkCentralLogContains(central)).resolves.toBeTruthy();
                await expect(broker.checkModuleLogContains(module)).resolves.toBeTruthy()

                await expect(broker.stop()).resolves.toBeTruthy();
                await expect(engine.stop()).resolves.toBeTruthy();
            }
        }

    }, 400000);

});
