import random
from os import makedirs, rmdir
from os.path import exists

class ConfigEngine:
  def __init__(self) -> None:
      self.hosts = []
      self.last_host_id = 0
      self.commands_count = 50

      
  def create_centengine(id: int, option):
      return """#cfg_file=/etc/centreon-engine/config{0}/hostTemplates.cfg
cfg_file=/etc/centreon-engine/config{0}/hosts.cfg
#cfg_file=/etc/centreon-engine/config{0}/serviceTemplates.cfg
cfg_file=/etc/centreon-engine/config{0}/services.cfg
cfg_file=/etc/centreon-engine/config{0}/commands.cfg
#cfg_file=/etc/centreon-engine/config{0}/contactgroups.cfg
#cfg_file=/etc/centreon-engine/config{0}/contacts.cfg
cfg_file=/etc/centreon-engine/config{0}/hostgroups.cfg
#cfg_file=/etc/centreon-engine/config{0}/servicegroups.cfg
cfg_file=/etc/centreon-engine/config{0}/timeperiods.cfg
#cfg_file=/etc/centreon-engine/config{0}/escalations.cfg
#cfg_file=/etc/centreon-engine/config{0}/dependencies.cfg
cfg_file=/etc/centreon-engine/config{0}/connectors.cfg
#cfg_file=/etc/centreon-engine/config{0}/meta_commands.cfg
#cfg_file=/etc/centreon-engine/config{0}/meta_timeperiod.cfg
#cfg_file=/etc/centreon-engine/config{0}/meta_host.cfg
#cfg_file=/etc/centreon-engine/config{0}/meta_services.cfg
broker_module=/usr/lib64/centreon-engine/externalcmd.so
broker_module=/usr/lib64/nagios/cbmod.so /etc/centreon-broker/central-module.json
interval_length=60
use_timezone=:Europe/Paris
resource_file=/etc/centreon-engine/config${id}/resource.cfg
log_file=/var/log/centreon-engine/config${id}/centengine.log
status_file=/var/log/centreon-engine/config${id}/status.dat
command_check_interval=1s
command_file=/var/lib/centreon-engine/config${id}/rw/centengine.cmd
state_retention_file=/var/log/centreon-engine/config${id}/retention.dat
retention_update_interval=60
sleep_time=0.2
service_inter_check_delay_method=s
service_interleave_factor=s
max_concurrent_checks=400
max_service_check_spread=5
check_result_reaper_frequency=5
low_service_flap_threshold=25.0
high_service_flap_threshold=50.0
low_host_flap_threshold=25.0
high_host_flap_threshold=50.0
service_check_timeout=10
host_check_timeout=12
event_handler_timeout=30
notification_timeout=30
ocsp_timeout=5
ochp_timeout=5
perfdata_timeout=5
date_format=euro
illegal_object_name_chars=~!$%^&*"|'<>?,()=
illegal_macro_output_chars=\`~$^&"|'<>
admin_email=titus@bidibule.com
admin_pager=admin
event_broker_options=-1
cached_host_check_horizon=60
debug_file=/var/log/centreon-engine/config${id}/centengine.debug
debug_level=${1}
debug_verbosity=2
log_pid=1
macros_filter=KEY80,KEY81,KEY82,KEY83,KEY84
enable_macros_filter=0
grpc_port=50001
postpone_notification_to_timeperiod=0
instance_heartbeat_interval=30
enable_notifications=1
execute_service_checks=1
accept_passive_service_checks=1
enable_event_handlers=1
check_external_commands=1
use_retained_program_state=1
use_retained_scheduling_info=1
use_syslog=0
log_notifications=1
log_service_retries=1
log_host_retries=1
log_event_handlers=1
log_external_commands=1
soft_state_dependencies=0
obsess_over_services=0
process_performance_data=0
check_for_orphaned_services=0
check_for_orphaned_hosts=0
check_service_freshness=1
enable_flap_detection=0
""".format(id, option.debug_level)


  def create_host(self):
    self.last_host_id += 1
    id = self.last_host_id
    a = id % 255
    q = id / 255
    b = q % 255
    q /= 255
    c = q % 255
    q /= 255
    d = q % 255

    retval = {}
    retval.config = """define host {                                                                   
    host_name                      host_{0}
    alias                          host_{0}
    address                        {1}.{2}.{3}.{4}
    check_command                  check
    check_period                   24x7
    register                       1
    _KEY${id}                      VAL{0}
    _SNMPCOMMUNITY                 public                                       
    _SNMPVERSION                   2c                                           
    _HOST_ID                       {0}
}
""".format(id, a, b, c, d)
    retval.id = id
    return retval


  def create_service(self, host_id: int, cmd_ids):
    self.last_service_id += 1
    service_id = self.last_service_id

    command_id = random.randint(cmd_ids[0], cmd_ids[1])
    return """define service {
    host_name                       host_{0}
    service_description             service_{1}
    _SERVICE_ID                     ${serviceId}
    check_command                   command_{2}
    max_check_attempts              3
    check_interval                  5
    retry_interval                  5
    register                        1
    active_checks_enabled           1
    passive_checks_enabled          1
}
""".format(host_id, service_id, command_id)


  def build_configs(self, count: int, hosts: int, services_by_host: int, option):
    v = hosts / count
    last = hosts - (count - 1) * v
    for inst in range(count):
      hosts = v
      config_dir = "/etc/centreon-engine/config{}".format(inst)
      if exists(config_dir):
        rmdir(config_dir)
      makedirs(config_dir)
      f = open(config_dir + "/centengine.cfg", "w")
      f.write(self.create_centengine(inst, option))
      f.close()

      f = open(config_dir + "/hosts.cfg", "w")
      for i in range(1, hosts + 1):
        h = self.create_host()
        f.write(h.config)
        self.hosts.push("host_" + h.id)
        ff = open(config_dir + "/services.cfg", "w")
        for j in range(1, services_by_host + 1):
          ff.write(self.create_service(h.id, (inst * self.commands_count + 1, (inst + 1) * self.commands_count)))
        ff.close()
      f.close()