import sleep from "await-sleep";
import shell from "shelljs";
import { Broker, BrokerType } from "../core/broker";
import { Engine } from "../core/engine";
import { isBrokerAndEngineConnected } from "../core/brokerEngine";
import { readFileSync } from "fs";
import path = require("path");

shell.config.silent = true;

beforeEach(async () => {
  shell.exec("service mysqld start");
  await Broker.cleanAllInstances();
  await Engine.cleanAllInstances();

  Broker.resetConfig(BrokerType.central);
  Broker.clearLogs(BrokerType.central);
}, 30000);

afterEach(async () => {
  Broker.cleanAllInstances();
});

it("should deny access when database name exists but is not the good one for sql output", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql["db_name"] = "centreon";
  await Broker.writeConfig(BrokerType.central, config);

  /* Loading of the two broker instances. */
  const broker = new Broker();
  const isStarted = await broker.start();
  const logTest1 = await broker.checkCentralLogContains([
    "Table 'centreon.instances' doesn't exist",
  ]);
  const isStopped = await broker.stop();

  Broker.cleanAllInstances();

  expect(isStarted).toBeTruthy();
  expect(logTest1).toBeTruthy();
  expect(isStopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 120000);

it("should deny access when database name exists but is not the good one for storage output", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centrealBrokerMasterPerfData = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-perfdata"
  );
  centrealBrokerMasterPerfData["db_name"] = "centreon";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const started = await broker.start();
  const checkLog1 = await broker.checkCentralLogContains([
    "[sql] [error] storage: rebuilder: Unable to connect to the database: storage: rebuilder: could not fetch index to rebuild",
  ]);
  const isStopped = await broker.stop();

  /* Cleanup */
  Broker.cleanAllInstances();

  expect(started).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(isStopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 30000);

it("should deny access when database name does not exists for sql output", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql["db_name"] = "centreon1";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const started = await broker.start();

  let checkLog1 = await broker.checkCentralLogContains([
    "[core] [error] failover: global error: mysql_connection: error while starting connection",
  ]);
  const stopped = await broker.stop();

  Broker.cleanAllInstances();

  expect(started).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(stopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 120000);

it("should deny access when database name does not exist for storage output", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centrealBrokerMasterPerfData = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-perfdata"
  );
  centrealBrokerMasterPerfData["db_name"] = "centreon1";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  expect(await broker.start()).toBeTruthy();

  expect(
    await broker.checkCentralLogContains([
      "[sql] [error] storage: rebuilder: Unable to connect to the database: mysql_connection: error while starting connection",
    ])
  ).toBeTruthy();

  const isStopped = await broker.stop();
  expect(isStopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 30000);

it("should deny access when database user password is wrong for sql", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql["db_password"] = "centreon1";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const isStarted = await broker.start();

  expect(await broker.isRunning()).toBeTruthy();

  expect(
    await broker.checkCentralLogContains([
      "[core] [error] failover: global error: mysql_connection: error while starting connection",
    ])
  ).toBeTruthy();

  const isStopped = await broker.stop();
  expect(isStopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 30000);

it("should log error when database name is not correct", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql["db_name"] = "centreon1";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const isStarted = await broker.start();

  let checkLog1 = broker.checkCentralLogContains([
    "[core] [error] failover: global error: mysql_connection: error while starting connection",
  ]);
  const isStopped = await broker.stop();

  Broker.cleanAllInstances();

  expect(isStarted).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(isStopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 60000);

it("multi connections step 1", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql.connections_count = "4";

  const centralBrokerMasterPerfdata = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-perfdata"
  );
  centralBrokerMasterPerfdata.connections_count = "4";

  const loggers = config["centreonBroker"]["log"]["loggers"];
  loggers["sql"] = "info";

  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const started = await broker.start();

  const checkLog1 = await broker.checkCentralLogContains(
    ["[sql] [info] mysql connector configured with 4 connection(s)"],
    30
  );
  const stopped = await broker.stop();

  Broker.cleanAllInstances();

  expect(started).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(stopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 60000);

it("multi connections step 2", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql.connections_count = "5";

  const centralBrokerMasterPerfdata = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-perfdata"
  );
  centralBrokerMasterPerfdata.connections_count = "5";

  const loggers = config["centreonBroker"]["log"]["loggers"];
  loggers["sql"] = "info";

  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  const started = await broker.start();
  const checkLog1 = await broker.checkCentralLogContains([
    "[sql] [info] mysql connector configured with 5 connection(s)",
  ]);
  const stopped = await broker.stop();

  Broker.cleanAllInstances();

  expect(started).toBeTruthy();
  expect(checkLog1).toBeTruthy();
  expect(stopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 60000);

it("mariadb server down", async () => {
  const broker = new Broker();
  const started = await broker.start();

  let state: boolean[] = [];
  for (let i = 0; i < 10; ++i) {
    console.log(`Step ${i + 1}/10`);
    shell.exec("service mysqld stop");
    await sleep(10000);
    shell.exec("service mysqld start");
    await sleep(10000);
    state.push(await broker.isRunning(1, 1));
  }

  const stopped = await broker.stop();

  expect(started).toBeTruthy();
  expect(state.every((s) => s)).toBeTruthy();
  expect(stopped).toBeTruthy();
  expect(await broker.checkCoredump()).toBeFalsy();
}, 300000);

it("repeat 20 times start/stop cbd with a wrong configuration in perfdata", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterPerfdata = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-perfdata"
  );
  centralBrokerMasterPerfdata["db_host"] = "1.2.3.4";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  let started: boolean[] = [];
  for (let i = 0; i < 20; ++i) {
    console.log(`Step ${i + 1}/20`);
    const s = await broker.start();
    if (!s) break;
    started.push(s);
    await sleep(2000);
    var stopped = await broker.stop();
    if (!stopped) break;
    expect(await broker.checkCoredump()).toBeFalsy();
  }

  Broker.cleanAllInstances();

  expect(stopped);
  expect(started.length).toEqual(20);
  expect(started.every((s) => s));
  expect(
    await broker.checkCentralLogContains([
      "[sql] [error] storage: rebuilder: Unable to connect to the database: mysql_connection: error while starting connection",
    ])
  ).toBeTruthy();
}, 350000);

it("repeat 20 times start/stop cbd with a wrong configuration in sql", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const centralBrokerMasterSql = config["centreonBroker"]["output"].find(
    (output) => output.name === "central-broker-master-sql"
  );
  centralBrokerMasterSql["db_host"] = "1.2.3.4";
  await Broker.writeConfig(BrokerType.central, config);

  const broker = new Broker();
  let started: boolean[] = [];
  for (let i = 0; i < 20; ++i) {
    console.log(`Step ${i + 1}/20`);
    const s = await broker.start();
    if (!s) break;
    started.push(s);
    await sleep(2000);
    var stopped = await broker.stop();
    if (!stopped) break;
    expect(await broker.checkCoredump()).toBeFalsy();
  }

  Broker.cleanAllInstances();

  expect(stopped);
  expect(started.length).toEqual(20);
  expect(started.every((s) => s));
  expect(
    await broker.checkCentralLogContains([
      "[sql] [error] conflict_manager: not initialized after 10s. Probably an issue in the sql output configuration",
    ])
  ).toBeTruthy();
}, 350000);

it("broker without database", async () => {
  const config = await Broker.getConfig(BrokerType.central);
  const broker = new Broker();
  const engine = new Engine();

  shell.exec("service mysql stop");

  const brokerStarted = await broker.start();

  const engineStarted = await engine.start();
  const connected = await isBrokerAndEngineConnected();

  expect(brokerStarted).toBeTruthy();
  expect(engineStarted).toBeTruthy();
  expect(connected).toBeTruthy();
  expect(
    await broker.checkCentralLogContains([
      "[core] [error] failover: global error: storage: Unable to initialize the storage connection to the database",
    ])
  ).toBeTruthy();

  shell.exec("service mysql start");

  let d = Date.now();

  while (Date.now() < d + 20000) {
    let rawdata;
    let jsonstats;
    try {
      rawdata = readFileSync(
        path.resolve(
          __dirname,
          "/var/lib/centreon-broker/central-broker-master-stats.json"
        )
      );
      jsonstats = JSON.parse(rawdata.toString());
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

  await expect(broker.stop()).resolves.toBeTruthy();
  await expect(engine.stop()).resolves.toBeTruthy();

  await expect(broker.checkCoredump()).resolves.toBeFalsy();
  await expect(engine.checkCoredump()).resolves.toBeFalsy();
}, 350000);
