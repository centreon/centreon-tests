import sleep from 'await-sleep';
import shell from 'shelljs';
import { once } from 'events'
import { Engine } from '../core/engine';
import { Broker } from '../core/broker';

shell.config.silent = true;

describe("start and stop engine", () => {
    beforeEach(() => {
        Broker.cleanAllInstances();
        Engine.cleanAllInstances();
    })

    afterAll(() => {
        beforeEach(() => {
            Broker.cleanAllInstances();
            Engine.cleanAllInstances();
        })
    })


    it('start/stop centengine', async () => {
        const engine = new Engine(2);
        Engine.buildConfigs(50, 40);
        //const started = await engine.start();
        //expect(started).toBeTruthy();

        //const stopped = await engine.stop();
        //expect(stopped).toBeTruthy();
        //expect(await Engine.checkCoredump()).toBeFalsy()
    }, 30000);

    /*    it('start and stop many instances engine', async () => {
    
            for (let i = 0; i < 3; ++i) {
                console.log(`Step ${i + 1}/3`);
                const engine = new Engine();
                const isStarted = await engine.start();
                expect(isStarted).toBeTruthy();
    
                await sleep(300);
                const isStoped = await engine.stop();
                expect(isStoped).toBeTruthy();
                expect(await engine.checkCoredump()).toBeFalsy();
            }
        }, 120000);
    */

});