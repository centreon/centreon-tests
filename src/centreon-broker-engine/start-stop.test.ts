import shell from 'shelljs';
import { Broker } from '../core/broker';
import { Engine } from '../core/engine';
import { isBrokerAndEngineConnected } from '../core/brokerEngine';

shell.config.silent = true;

describe('engine and broker testing in same time', () => {

    beforeEach(() => {
        Broker.cleanAllInstances();
        Engine.cleanAllInstances();
        
        Broker.clearLogs()
        Broker.resetConfig()

        if ((Broker.isServiceRunning()) || (Engine.isServiceRunning())) {
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
        await expect( engine.start()).resolves.toBeTruthy()
        
        await expect( isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect( engine.stop()).resolves.toBeTruthy();
        await expect( engine.start()).resolves.toBeTruthy()

        await expect( isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect( engine.stop()).resolves.toBeTruthy();
        await expect( broker.stop()).resolves.toBeTruthy();

        await expect(broker.checkCoredump()).resolves.toBeFalsy()
        await expect(engine.checkCoredump()).resolves.toBeFalsy()

    }, 60000);


    it('start/stop centreon broker/engine - engine first', async () => {
        const engine = new Engine()
        await expect(engine.start()).resolves.toBeTruthy()

        const broker = new Broker(1);
        await expect( broker.start()).resolves.toBeTruthy()

        await expect( isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect( broker.stop()).resolves.toBeTruthy();
        await expect( broker.start()).resolves.toBeTruthy()

        await expect( isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect( broker.stop()).resolves.toBeTruthy();
        await expect( engine.stop()).resolves.toBeTruthy();

        await expect( broker.checkCoredump()).resolves.toBeFalsy()
        await expect( engine.checkCoredump()).resolves.toBeFalsy()
    }, 60000);

    it('should handle database service stop and start', async () => {
        const broker = new Broker();

        shell.exec('service mysql stop')

        await expect( Broker.isMySqlRunning()).resolves.toBeTruthy()

        await expect( broker.start()).resolves.toBeTruthy()

        const engine = new Engine()
        await expect( engine.start()).resolves.toBeTruthy()

        await expect( isBrokerAndEngineConnected()).resolves.toBeTruthy()

        await expect( Broker.checkLogFileContains(['[core] [error] failover: global error: storage: Unable to initialize the storage connection to the database'])).resolves.toBeTruthy()

        await expect( broker.stop()).resolves.toBeTruthy();
        await expect( engine.stop()).resolves.toBeTruthy();

        await expect( broker.checkCoredump()).resolves.toBeFalsy()
        await expect( engine.checkCoredump()).resolves.toBeFalsy()

    }, 60000);
});
