*** Settings ***
Documentation	Centreon Broker only start/stop tests
Library	Process
Library	OperatingSystem
Library	BrokerConfig.py

*** Test cases ***
BSS1: Start-Stop two instances of broker and no coredump
	Remove Logs
	Repeat Keyword	5 times	Start Stop Service

BSS3: Start-Stop one instance of broker and no coredump
	Remove Logs
	Config Broker	central
	Repeat Keyword	5 times	Start Stop Instance	0

Start-Stop with reversed connection on TCP acceptor with only one instance and no deadlock
	Remove Logs
	Config Broker	central
	Config Output	central	centreon-broker-master-rrd	one_peer_retention
	Repeat Keyword	5 times	Start Stop Instance	1s

BSS2: Start/Stop 10 times broker with 300ms interval and no coredump
	Remove Logs
	Config Broker	central
	Repeat Keyword	10 times	Start Stop Instance	300ms

BSS3: Start/Stop 10 times broker with 1sec interval and no coredump
	Remove Logs
	Config Broker	central
	Repeat Keyword	10 times	Start Stop Instance	1s

*** Keywords ***
Start Stop Service
	Config Broker	central
	Config Broker	rrd
	Start Process	/usr/sbin/cbd	/etc/centreon-broker/central-broker.json	alias=b1
	Start Process	/usr/sbin/cbd	/etc/centreon-broker/central-rrd.json	alias=b2
	${result1}=	Terminate Process	b1
	Should Be Equal As Integers	${result1.rc}	0
	Terminate Process	b1
	${result2}=	Terminate Process	b2
	Should Be Equal As Integers	${result2.rc}	0
	Terminate Process	b2

Start Stop Instance
	[Arguments]	${interval}
	Start Process	/usr/sbin/cbd	/etc/centreon-broker/central-broker.json
	${result}=	Terminate Process
	Should Be Equal As Integers	${result.rc}	0
	Sleep	${interval}
	Terminate Process

Remove Logs
	Remove Files	${BROKER_LOG}${/}central-broker-master.log	${BROKER_LOG}${/}central-rrd-master.log ${BROKER_LOG}${/}central-module-master.log

*** Variables ***
${BROKER_LOG}	/var/log/centreon-broker

