import shell from "shelljs";
import { Broker, BrokerType } from "../core/broker";
import { Engine } from "../core/engine";
import { isBrokerAndEngineConnected } from "../core/brokerEngine";
import sleep from "await-sleep";

shell.config.silent = true;

describe("engine and broker testing in same time", () => {
  beforeEach(async () => {
    await Engine.cleanAllInstances();
    await Broker.cleanAllInstances();

    Broker.clearLogs(BrokerType.central);
    Broker.resetConfig(BrokerType.central);
    Engine.clearLogs();

    if (Broker.isInstancesRunning() || Engine.isRunning()) {
      console.log("program could not stop cbd or centengine");
      process.exit(1);
    }
  });

  afterAll(() => {
    beforeEach(async () => {
      await Engine.cleanAllInstances();
      await Broker.cleanAllInstances();

      //Broker.clearLogs();
      //Broker.resetConfig();
      //Engine.clearLogs();
    });
  });

  it("start/stop centreon broker/engine - broker first", async () => {
    const broker = new Broker(1);
    await expect(broker.start()).resolves.toBeTruthy();

    const engine = new Engine();
    await expect(engine.start()).resolves.toBeTruthy();

    await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

    await expect(engine.stop()).resolves.toBeTruthy();
    await expect(engine.start()).resolves.toBeTruthy();

    await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

    await expect(engine.stop()).resolves.toBeTruthy();
    await expect(broker.stop()).resolves.toBeTruthy();

    await expect(broker.checkCoredump()).resolves.toBeFalsy();
    await expect(engine.checkCoredump()).resolves.toBeFalsy();
  }, 60000);

  it("start/stop centreon broker/engine - engine first", async () => {
    const engine = new Engine();
    await expect(engine.start()).resolves.toBeTruthy();

    const broker = new Broker(1);
    await expect(broker.start()).resolves.toBeTruthy();

    await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

    await expect(broker.stop()).resolves.toBeTruthy();
    await expect(broker.start()).resolves.toBeTruthy();

    await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

    await expect(broker.stop()).resolves.toBeTruthy();
    await expect(engine.stop()).resolves.toBeTruthy();

    await expect(broker.checkCoredump()).resolves.toBeFalsy();
    await expect(engine.checkCoredump()).resolves.toBeFalsy();
  }, 60000);

  it("should handle database service stop and start", async () => {
    const broker = new Broker();

    shell.exec("service mysql stop");

    await expect(Broker.isMySqlRunning()).resolves.toBeTruthy();

    await expect(broker.start()).resolves.toBeTruthy();

    const engine = new Engine();
    await expect(engine.start()).resolves.toBeTruthy();

    await expect(isBrokerAndEngineConnected()).resolves.toBeTruthy();

    await expect(
      broker.checkCentralLogContains([
        "[core] [error] failover: global error: storage: Unable to initialize the storage connection to the database",
      ])
    ).resolves.toBeTruthy();

    await expect(broker.stop()).resolves.toBeTruthy();
    await expect(engine.stop()).resolves.toBeTruthy();

    await expect(broker.checkCoredump()).resolves.toBeFalsy();
    await expect(engine.checkCoredump()).resolves.toBeFalsy();
  }, 60000);
});

it.only("broker without database", async () => {
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
          path.resolve(
            __dirname,
            "/var/lib/centreon-broker/central-broker-master-stats.json"
          )
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
