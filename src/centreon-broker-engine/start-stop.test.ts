import shell from "shelljs";
import { Broker, BrokerType } from "../core/broker";
import { Engine } from "../core/engine";
import { isBrokerAndEngineConnected } from "../core/brokerEngine";
import sleep from "await-sleep";
import { readFileSync } from "fs";
shell.config.silent = true;

describe("engine and broker testing in same time", () => {
  beforeEach(async () => {
    await Engine.cleanAllInstances();
    await Broker.cleanAllInstances();

    Broker.clearLogs(BrokerType.central);
    Engine.clearLogs();
    Broker.resetConfig(BrokerType.central);

    if (Broker.isInstancesRunning() || Engine.isInstancesRunning()) {
      console.log("program could not stop cbd or centengine");
      process.exit(1);
    }
  });

  it("start/stop centreon broker/engine - broker first", async () => {
    Broker.startMysql();

    const broker = new Broker(1);
    const engine = new Engine();
    Engine.buildConfigs();

    const started1 = await broker.start();
    const started2 = await engine.start();
    const connected = await isBrokerAndEngineConnected();

    const stopped1 = await broker.stop();
    const stopped2 = await engine.stop();

    Broker.cleanAllInstances();
    Engine.cleanAllInstances();

    expect(started1).toBeTruthy();
    expect(started2).toBeTruthy();
    expect(connected).toBeTruthy();
    expect(stopped1).toBeTruthy();
    expect(stopped2).toBeTruthy();

    await expect(broker.checkCoredump()).resolves.toBeFalsy();
    await expect(engine.checkCoredump()).resolves.toBeFalsy();
  }, 60000);

  it("start/stop centreon broker/engine - engine first", async () => {
    const broker = new Broker(1);
    const engine = new Engine();

    const started2 = await engine.start();
    const started1 = await broker.start();
    const connected = await isBrokerAndEngineConnected();

    const stopped1 = await broker.stop();
    const stopped2 = await engine.stop();

    Broker.cleanAllInstances();
    Engine.cleanAllInstances();

    expect(started1).toBeTruthy();
    expect(started2).toBeTruthy();
    expect(connected).toBeTruthy();
    expect(stopped1).toBeTruthy();
    expect(stopped2).toBeTruthy();

    await expect(broker.checkCoredump()).resolves.toBeFalsy();
    await expect(engine.checkCoredump()).resolves.toBeFalsy();
  }, 60000);

  it("BEDB1: should handle database service stop and start", async () => {
    const broker = new Broker(2);
    const engine = new Engine();
    Engine.buildConfigs();

    Broker.startMysql();

    const started1 = await broker.start();
    const started2 = await engine.start();

    const connected = await isBrokerAndEngineConnected();

    let cd1: boolean = false;
    let checkLog1: boolean = true;
    if (started1 && started2) {
      for (let i = 0; i < 5 && !cd1 && checkLog1; i++) {
        Broker.stopMysql();
        await sleep(1);
        cd1 = await broker.checkCoredump();
        Broker.startMysql();
        const checkLog1 = await broker.checkCentralLogContains(
          ["[sql] [debug] conflict_manager: storage stream initialization"],
          30
        );
      }
    }

    const stopped1 = await broker.stop();
    const stopped2 = await engine.stop();
    const cd2: boolean = await broker.checkCoredump();
    const cd3: boolean = await engine.checkCoredump();

    Broker.cleanAllInstances();
    Engine.cleanAllInstances();

    expect(started1).toBeTruthy();
    expect(started2).toBeTruthy();
    expect(connected).toBeTruthy();
    expect(cd1).toBeFalsy();
    expect(checkLog1).toBeTruthy();
    expect(cd2).toBeFalsy();
    expect(cd3).toBeFalsy();
    expect(stopped1).toBeTruthy();
    expect(stopped2).toBeTruthy();
  }, 60000);
});

it("broker without database", async () => {
  const duration = 20000;
  const broker = new Broker();
  const engine = new Engine();

  Engine.buildConfigs();

  shell.exec("systemctl stop mysqld");

  const brokerStarted = await broker.start();
  const engineStarted = await engine.start();
  if (brokerStarted && engineStarted) {
    var connected = await isBrokerAndEngineConnected();

    var checkLog1 = await broker.checkCentralLogContains([
      "[core] [error] failover: global error: storage: Unable to initialize the storage connection to the database",
    ]);

    shell.exec("systemctl stop mysqld");

    let d = Date.now() + duration;

    while (Date.now() < d) {
      let rawdata: string;
      let jsonstats;
      try {
        rawdata = readFileSync(
          "/var/lib/centreon-broker/central-broker-master-stats.json"
        ).toString();
        jsonstats = JSON.parse(rawdata);
      } catch (e) {
        console.log(e);
      }

      if (!(Object.keys(rawdata).length == 0)) {
        if (
          jsonstats["endpoint central-broker-master-sql"].hasOwnProperty(
            "conflict_manager"
          )
        ) {
          console.log(
            jsonstats["endpoint central-broker-master-sql"]["conflict_manager"]
          );
          break;
        }
      }
    }

    var brokerStopped = broker.stop();
    var engineStopped = engine.stop();
  }

  Broker.cleanAllInstances();
  Engine.cleanAllInstances();

  expect(brokerStarted).toBeTruthy();
  expect(engineStarted).toBeTruthy();
  expect(connected).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(brokerStopped).toBeTruthy();
  expect(engineStopped).toBeTruthy();

  await expect(broker.checkCoredump()).resolves.toBeFalsy();
  await expect(engine.checkCoredump()).resolves.toBeFalsy();
}, 350000);
