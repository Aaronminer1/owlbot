"""No hardware: verify saved endpoints, locks, migration and paced output."""
import os
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'firmware'/'pico'))
import servo_channels
from dog_engine import DogEngine
from gimbal_engine import GimbalEngine


class Board:
    def __init__(self):self.writes=[];self.releases=[];self.retained_servo_ports=set()
    def servoWriteMicros(self,port,pulse):self.writes.append((port,pulse))
    def release(self,port,force=False):
        if force:self.retained_servo_ports.discard(port)
        if port not in self.retained_servo_ports:self.releases.append(port)
    def releaseAll(self,force=False):
        for port in range(1,17):self.release(port,force)


class ChannelTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.previous=os.getcwd();os.chdir(self.directory.name)
        self.clock=0
        servo_channels.time.ticks_ms=lambda:self.clock
        servo_channels.time.ticks_diff=lambda a,b:a-b
        self.board=Board();self.dog=DogEngine(self.board);self.gaze=GimbalEngine(self.board)
        self.engine=servo_channels.ServoChannels(self.board,self.dog,self.gaze)
    def tearDown(self):os.chdir(self.previous);self.directory.cleanup()
    def configure(self,ch=15,**values):
        c=dict(self.engine.channels[ch]);c['locked']=False;self.engine.configure(c)
        c.update(enabled=True,name='My claw %d'%ch,group='arm',a_name='Open',b_name='Closed',a_us=1750,b_us=1250,center_us=1500,calibrated=True)
        c.update(values);self.engine.configure(c);return c
    def ticks(self,n):
        for _ in range(n):self.clock+=20;self.engine.step()
    def test_startup_and_config_emit_no_pulses(self):
        self.configure();self.assertEqual(self.board.writes,[]);self.assertEqual(len(self.engine.channels),16)
    def test_turn_close_does_not_first_open_to_midpoint_after_release(self):
        self.configure(7,name='Turn',a_name='Closed',b_name='Open',a_us=1612,b_us=1019,center_us=1316)
        before=json.dumps(self.engine.channels)
        for _ in range(2):
            self.engine.move([{'channel':7,'position':'Closed'}],speed=150)
            self.ticks(5)
            self.assertTrue(all(pulse==1612 for port,pulse in self.board.writes if port==8))
            self.assertEqual(self.engine.current[7],1612)
            self.engine.stop()
        self.assertEqual(before,json.dumps(self.engine.channels))
    def test_turn_calibration_keeps_existing_midpoint_ramp(self):
        self.configure(7,name='Turn',a_name='Closed',b_name='Open',a_us=1612,b_us=1019,center_us=1316)
        self.engine.move([{'channel':7,'pulse_us':1612}],calibration=True,speed=150)
        self.ticks(2)
        self.assertLess(self.board.writes[-1][1],1325)
    def test_custom_channel_15_and_reverse_named_positions_persist(self):
        saved=self.configure(15,locked=True)
        restored=servo_channels.ServoChannels(self.board,self.dog,self.gaze)
        self.assertEqual(restored.channels[15],saved)
        restored.move([{'channel':15,'position':'Open'}]);self.assertEqual(restored.queue,[(15,1750)])
    def test_locked_edit_and_calibration_rejected_but_operating_allowed(self):
        saved=self.configure(15,locked=True)
        with self.assertRaises(ValueError):self.engine.configure(dict(saved,a_us=1900))
        with self.assertRaises(ValueError):self.engine.move([{'channel':15,'pulse_us':1500}],True)
        self.engine.move([{'channel':15,'position':'Closed'}]);self.assertEqual(self.engine.queue,[(15,1250)])
    def test_rate_limited_even_after_clock_stall(self):
        self.configure();self.engine.move([{'channel':15,'pulse_us':2000}],True,100)
        self.ticks(50)
        pulses=[p for port,p in self.board.writes]
        self.assertTrue(all(port==16 for port,_ in self.board.writes))
        self.assertLessEqual(max(pulses),1600)
        self.assertTrue(all(b-a<=2 for a,b in zip(pulses,pulses[1:])))
        self.clock+=5000;self.engine.step();self.assertLessEqual(self.board.writes[-1][1]-pulses[-1],4)
    def test_sequence_completes_each_channel_before_next(self):
        self.configure(14);self.configure(15)
        self.engine.move([{'channel':14,'position':'Open'},{'channel':15,'position':'Closed'}])
        self.ticks(270)
        writes=self.board.writes;first_second=next(i for i,x in enumerate(writes) if x[0]==16)
        self.assertEqual(writes[first_second-1],(15,1750));self.assertEqual(writes[-1],(16,1250))
    def test_disabled_unverified_unknown_endpoint_and_bounds_rejected(self):
        with self.assertRaises(ValueError):self.engine.move([{'channel':15,'position':'Open'}])
        self.configure(calibrated=False)
        with self.assertRaises(ValueError):self.engine.move([{'channel':15,'position':'Open'}])
        self.configure()
        with self.assertRaises(ValueError):self.engine.move([{'channel':15,'position':'Left'}])
        with self.assertRaises(ValueError):self.engine.move([{'channel':15,'pulse_us':2300}])
    def test_stop_cancels_ramp_and_release_all_sixteen(self):
        self.configure();self.engine.move([{'channel':15,'position':'Open'}]);self.ticks(5)
        self.engine.stop();count=len(self.board.writes);self.ticks(100)
        self.assertEqual(len(self.board.writes),count);self.assertIn(16,self.board.releases)
    def test_invalid_save_keeps_previous_file(self):
        self.configure();before=Path('servo_channels.json').read_bytes()
        with self.assertRaises(ValueError):self.engine.configure(dict(self.engine.channels[15],a_us=100))
        self.assertEqual(Path('servo_channels.json').read_bytes(),before)
    def test_up_endpoint_updates_old_gait_direction_and_limits(self):
        self.configure(1,name='Right front',group='legs',a_name='Up',b_name='Down',a_us=2000,b_us=1000)
        self.assertEqual(self.dog.lift_endpoints['front_right'],'max')
        self.assertEqual(self.dog.limits['front_right'],[1000,2000])
    def test_corrupt_configuration_disables_outputs_instead_of_restoring_defaults(self):
        Path('servo_channels.json').write_text('{broken')
        restored=servo_channels.ServoChannels(self.board,self.dog,self.gaze)
        self.assertTrue(restored.config_error)
        self.assertTrue(all(not c['enabled'] for c in restored.channels))
        self.assertEqual(self.board.writes,[])
    def test_repeated_slider_targets_do_not_release_servos_between_updates(self):
        self.configure();self.engine.move([{'channel':15,'pulse_us':2000}],True)
        self.ticks(15);before=len(self.board.releases)
        self.engine.move([{'channel':15,'pulse_us':1900}],True)
        self.assertEqual(len(self.board.releases),before)
    def test_changing_queued_channel_cancels_old_motion(self):
        self.configure(14);self.configure(15)
        self.engine.move([{'channel':14,'position':'Open'},{'channel':15,'position':'Closed'}])
        self.ticks(3)
        self.engine.configure(dict(self.engine.channels[15],enabled=False))
        before=len(self.board.writes);self.ticks(400)
        self.assertEqual(len(self.board.writes),before)
    def test_duplicate_servo_names_are_rejected(self):
        self.configure(14,name='Claw')
        with self.assertRaises(ValueError):self.configure(15,name='Claw')
    def test_unused_persists_and_releases_held_output_without_moving(self):
        saved=self.configure(15)
        self.engine.move([{'channel':15,'position':'Open'}]);self.ticks(200)
        before=len(self.board.writes);releases=len(self.board.releases)
        saved['enabled']=False;self.engine.configure(saved)
        self.assertEqual(len(self.board.writes),before)
        self.assertIn(16,self.board.releases[releases:])
        restored=servo_channels.ServoChannels(self.board,self.dog,self.gaze)
        self.assertFalse(restored.channels[15]['enabled'])
        self.assertEqual(restored.channels[15]['a_us'],saved['a_us'])
        with self.assertRaises(ValueError):restored.move([{'channel':15,'position':'Open'}])


if __name__=='__main__':unittest.main()
