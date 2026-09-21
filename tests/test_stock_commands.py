"""Saved command codec and real dispatcher/executors; all outputs are fake."""
import unittest
from test_shared_body import SharedBodyTests
from stock_commands import StockCommands, frames, decode, NAMES, TURN_ALIASES, named_opcode


class StockCommandTests(SharedBodyTests):
    def setUp(self):
        super().setUp()
        self.commands = StockCommands(self.channels, self.gait,
            self.env['named_turn'], self.head, self.env['shared_body'],
            {'enabled': True, 'pattern_a_direction': 'right'})
        self.env['stock_commands'] = self.commands
        self.env.update(dog=self.channels.dog,gaze=self.channels.gaze)

    def command(self, op, **kwargs):
        return self.send(t='act', steps=frames(op), mode='replace', **kwargs)

    def tick_command(self, n=560):
        for _ in range(n):
            self.fixture.now += 20
            self.channels.step(); self.commands.step()
            self.env['named_turn'].step(); self.head.step()

    def test_exact_roundtrip_and_swap_invariance(self):
        for op in range(1, 8):
            self.assertEqual(decode(frames(op)), op)
            self.assertEqual(decode([dict(l=s['r'],r=s['l'],ms=s['ms']) for s in frames(op)]), op)
        self.assertIsNone(decode([dict(l=60,r=120,ms=180)]))

    def test_explicit_turn_and_spin_names_share_saved_executor(self):
        self.head.hold_enabled = True
        for name, op in TURN_ALIASES.items():
            with self.subTest(name=name):
                a = self.send(t='routine', name=name, rid=17)
                self.assertTrue(a['ok'])
                self.assertEqual(a['saved_body_command']['last'], NAMES[op-1])
                self.assertEqual(a['queued_ms'], 4800)
                self.assertEqual(self.env['named_turn'].pattern, 'b' if op==1 else 'a')
                self.tick_command()
                self.assertTrue(self.commands.completed)
                self.assertTrue(self.commands.return_closed)
                self.assertIsNone(self.commands.error)
                self.assertFalse(self.env['named_turn'].running)
                self.assertTrue(self.head.targets)
                self.send(t='stop')
                self.assertTrue(self.head.targets)
        self.send(t='dog_cal', channel_action='head_stop')
        self.assertFalse(self.head.targets)

    def test_alias_validation_and_busy_rules_preserved(self):
        for value in (None, [], {}, 'spin', 'spin_left_extra', 'right'):
            self.assertIsNone(named_opcode(value))
        self.commands.config['enabled'] = False
        self.assertFalse(self.send(t='routine', name='spin_left')['ok'])
        self.assertEqual(self.board.writes, [])
        self.commands.config['enabled'] = True
        self.assertFalse(self.send(t='routine', name='spin_left', mode='append')['ok'])
        self.assertTrue(self.send(t='routine', name='turn_right')['ok'])
        run = self.commands.run_id
        self.assertFalse(self.send(t='routine', name='spin_left')['ok'])
        self.assertEqual(self.commands.run_id, run)
        self.assertEqual(self.commands.active, 'turn right')
        self.send(t='stop')
        self.assertFalse(self.env['named_turn'].running)
        self.assertIsNone(self.commands.active)

    def test_aliases_do_not_reinterpret_pose_or_break_wiggle(self):
        for ch, name in ((1,'Left front leg'),(2,'Left rear leg'),
                         (3,'Right rear leg'),(5,'Right front leg')):
            self.channels.channels[ch]['name'] = name
        self.plan['steps'] = [self.fixture.bound(ch,pos) for ch,pos in self.order]
        self.gait.save(self.plan)
        a = self.send(t='pose', lr='120,60', name='spin_left', rid=1)
        self.assertTrue(a['ok'])
        self.assertEqual(self.commands.run_id, 0)
        self.assertFalse(self.env['named_turn'].running)
        self.send(t='stop')
        self.assertTrue(self.send(t='routine', name='wiggle')['ok'])
        self.assertEqual(self.commands.run_id, 0)
        self.assertFalse(self.send(t='routine', name='spin_left')['ok'])
        self.assertEqual(self.commands.run_id, 0)

    def test_ack_reports_actual_browser_window(self):
        for op in (1,3,4,7):
            ack=self.command(op)
            self.assertTrue(ack['ok'])
            self.assertEqual(ack['queued_ms'],sum(s['ms'] for s in frames(op)))
            self.send(t='stop')

    def test_bad_framing_never_reaches_stock_legs(self):
        cases = [frames(3)[:-1], frames(3)[1:], frames(3) + [frames(3)[-1]]]
        for i in range(8):
            for key in ('l','r','ms'):
                s=frames(3);s[i][key]+=1;cases.append(s)
        for steps in cases:
            self.assertFalse(self.send(t='act',steps=steps,mode='replace')['ok'])
        self.assertEqual(self.board.writes, [])
        self.assertFalse(self.stock.active)

    def test_disabled_missing_direction_and_append_do_not_move(self):
        self.commands.config={}
        self.assertFalse(self.command(3)['ok'])
        self.commands.config={'enabled':True}
        self.assertFalse(self.command(1)['ok'])
        self.assertFalse(self.send(t='act',steps=frames(3),mode='append')['ok'])
        self.assertEqual(self.board.writes, [])

    def test_all_head_gestures_touch_only_head_then_release(self):
        for op in range(3, 8):
            self.assertTrue(self.command(op)['ok'])
            self.tick_command()
            self.assertIsNone(self.commands.active)
            self.assertFalse(self.head.targets)
            self.assertTrue(self.commands.completed)
        self.assertTrue(self.board.writes)
        self.assertTrue(all(port in (9,10) for port,pulse in self.board.writes))

    def test_head_direction_and_center_are_semantic(self):
        expected={3:('pan',900),4:('pan',2100),5:('tilt',732),6:('tilt',978)}
        for op,(axis,pulse) in expected.items():
            self.assertTrue(self.command(op)['ok'])
            self.assertEqual(self.head.targets[axis],pulse)
            self.send(t='stop')
        self.assertTrue(self.command(7)['ok'])
        self.assertEqual(self.head.targets,{'pan':1500,'tilt':855})

    def test_turns_select_opposite_patterns_finish_closed_and_release(self):
        for op,pattern in ((1,'b'),(2,'a')):
            self.assertTrue(self.command(op)['ok'])
            turn=self.env['named_turn']
            self.assertEqual(turn.pattern,pattern)
            self.assertEqual(turn.fraction,0.15)
            self.assertEqual(self.commands.status()['turn_fraction'],0.15)
            self.assertEqual(turn.partial_open,round(1515+(1019-1515)*0.15))
            self.assertLessEqual(turn.run_speed,800)
            self.tick_command()
            self.assertIsNone(self.commands.error)
            self.assertFalse(turn.running)
            self.assertIsNone(self.commands.active)
            self.assertTrue(self.commands.completed)
            self.assertTrue(self.commands.return_closed)
            self.assertEqual([p for port,p in self.board.writes if port==8][-1],1515)

    def test_sixty_percent_with_installed_turn_endpoints_finishes_in_window(self):
        c=self.channels.channels[7]
        c.update(a_us=1678,b_us=1019,center_us=1349)
        self.gait.plan['speed_us_s']=1600
        self.commands.config['turn_fraction']=0.60
        for op in (1,2):
            self.assertTrue(self.command(op)['ok'])
            turn=self.env['named_turn']
            self.assertEqual(turn.partial_open,1283)
            self.assertEqual(turn.run_speed,800)
            started=self.fixture.now
            while self.commands.active and self.fixture.now-started<4800:
                self.tick_command(1)
            self.assertTrue(self.commands.completed)
            self.assertIsNone(self.commands.error)
            self.assertTrue(self.commands.return_closed)
            self.assertLess(self.fixture.now-started,4800)
            self.assertEqual([p for port,p in self.board.writes if port==8][-1],1678)

    def test_invalid_turn_fraction_never_moves(self):
        for value in (None,True,'0.6',0,0.61,float('nan'),float('inf')):
            self.commands.config['turn_fraction']=value
            self.assertFalse(self.command(1)['ok'])
            self.assertIsNone(self.commands.status()['turn_fraction'])
        self.assertEqual(self.board.writes,[])

    def test_pan_inversion_is_local_to_growbot_not_calibration_or_shared_api(self):
        before = [dict(c) for c in self.channels.channels]
        self.commands.config['pan_inverted'] = True
        self.assertTrue(self.commands.status()['pan_inverted'])
        for op, axis, pulse in ((3,'pan',2100),(4,'pan',900),
                                (5,'tilt',732),(6,'tilt',978)):
            self.assertTrue(self.command(op)['ok'])
            self.assertEqual(self.head.targets[axis],pulse)
            self.tick_command()
            self.assertTrue(self.commands.completed)
        self.command(7)
        self.assertEqual(self.head.targets,{'pan':1500,'tilt':855})
        self.send(t='stop')
        self.assertTrue(self.request('head',axis='pan',position=-0.2)['ok'])
        self.assertEqual(self.head.targets['pan'],1300)
        self.request('stop')
        self.assertEqual(self.channels.channels,before)
        self.test_turns_select_opposite_patterns_finish_closed_and_release()

    def test_pan_inversion_requires_explicit_boolean_true(self):
        for value in (None,False,1,'true','false'):
            self.commands.config['pan_inverted'] = value
            self.assertFalse(self.commands.status()['pan_inverted'])
            self.assertTrue(self.command(3)['ok'])
            self.assertEqual(self.head.targets['pan'],900)
            self.send(t='stop')

    def test_repeated_command_does_not_restart_and_stop_cancels(self):
        self.assertTrue(self.command(1)['ok']);run=self.commands.run_id
        self.assertFalse(self.command(1)['ok'])
        self.assertEqual(self.commands.run_id,run)
        self.send(t='stop');self.assertIsNone(self.commands.active)
        self.assertFalse(self.env['named_turn'].running)

    def test_status_does_not_extend_command_deadline(self):
        self.command(3)
        for _ in range(560):
            self.send(t='dog_cal',channel_action='info')
            self.tick_command(1)
        self.assertFalse(self.head.targets)
        self.assertIsNone(self.commands.active)

    def test_stalled_turn_times_out(self):
        self.command(1)
        self.fixture.now+=4801;self.commands.step()
        self.assertEqual(self.commands.error,'saved_turn_execution_timeout')
        self.assertFalse(self.env['named_turn'].running)

    def test_pan_window_covers_full_slow_travel_and_rejects_old_short_encoding(self):
        self.assertEqual(sum(s['ms'] for s in frames(3)),10286)
        old=frames(3)
        for s,d in zip(old,(137,149,163,181,193,197,2000,2000)):s['ms']=d
        self.assertFalse(self.send(t='act',steps=old,mode='replace')['ok'])
        self.assertEqual(self.board.writes,[])
        for op,pulse in ((3,900),(4,2100),(7,1500)):
            start=len(self.board.writes)
            self.assertTrue(self.command(op)['ok'])
            self.tick_command()
            self.assertTrue(self.commands.completed)
            pulses=[p for ch,p in self.board.writes[start:] if ch==9]
            self.assertEqual(pulses[-1],pulse)
            self.assertTrue(all(abs(a-b)<=6 for a,b in zip(pulses,pulses[1:])))

if __name__=='__main__': unittest.main()
