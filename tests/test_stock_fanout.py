"""Stock browser packets through the real dispatcher; no physical hardware."""
import unittest
import test_named_walk_dispatch as fixtures


class StockTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.DispatchTests();self.f.setUp()
        self.stock=self.f.stock;self.channels=self.f.channels;self.board=self.f.board
        for ch,name,up,down in ((1,'Left front leg',1561,1112),
                (2,'Left rear leg',2500,1960),(3,'Right rear leg',935,1113),
                (5,'Right front leg',1215,1734)):
            self.channels.channels[ch].update(name=name,a_name='Up',b_name='Down',
                a_us=up,b_us=down,center_us=round((up+down)/2))
        self.f.plan['steps']=[self.f.bound(ch,pos) for ch,pos in self.f.order]
        self.f.gait.save(self.f.plan)
    def tearDown(self):self.f.tearDown()
    def tick(self,count=1):
        for _ in range(count):
            self.f.now+=20;self.channels.step();self.stock.step()
    def send(self,**message):return self.f.send(**message)

    def test_read_only_mapping_and_endpoint_directions(self):
        self.assertFalse(self.stock.status()['active']);self.assertEqual(self.board.writes,[])
        down=self.stock.map_pose(0,180);up=self.stock.map_pose(180,0)
        for ch in (1,2,3,5):
            self.assertEqual(down[ch],self.channels.channels[ch]['b_us'])
            c=self.channels.channels[ch]
            self.assertEqual(up[ch],round(c['b_us']+(c['a_us']-c['b_us'])*.5))
        self.assertEqual(set(down),{1,2,3,5})

    def test_slider_groups_and_midpoint(self):
        middle=self.stock.map_pose(90,90)
        left=self.stock.map_pose(100,90);right=self.stock.map_pose(90,100)
        # Tucking beyond neutral clips; the opposite (downward) side still moves.
        self.assertEqual(left,middle)
        left=self.stock.map_pose(80,90)
        self.assertEqual([ch for ch in middle if left[ch]!=middle[ch]],[1,2])
        self.assertEqual({ch for ch in middle if right[ch]!=middle[ch]},{3,5})
        for ch in middle:
            c=self.channels.channels[ch]
            self.assertEqual(middle[ch],round(c['b_us']+(c['a_us']-c['b_us'])*.5))

    def test_fold_clips_at_named_walking_lift_without_changing_calibration(self):
        self.f.plan['lift_percent']=50
        self.f.gait.save(self.f.plan)
        before=[dict(c) for c in self.channels.channels]
        for l,r in ((130,50),(180,0),(999,-999)):
            folded=self.stock.map_pose(l,r)
            for ch in (1,2,3,5):
                expected=self.f.gait._target(dict(channel=ch,position='Up'))['pulse_us']
                self.assertEqual(folded[ch],expected)
        self.assertEqual(before,self.channels.channels)

    def test_every_streamed_output_stays_inside_tuck_envelope(self):
        # Seed the old full-Up command to test a handover, not only new targets.
        for c in self.channels.channels:
            if c['channel'] in (1,2,3,5):self.channels.current[c['channel']]=c['a_us']
        for left,right in ((180,0),(0,180),(90,90),(60,120),(120,60)):
            self.stock.pose(left,right);self.tick(10)
        rows={r['channel']:r for r in self.stock.mapping()}
        for port,pulse in self.board.writes:
            row=rows[port-1]
            self.assertEqual(pulse,self.stock.bound_pulse(row,pulse))

    def test_fold_gesture_and_hold_share_tuck_ceiling(self):
        self.stock.enqueue([dict(l=180,r=0,ms=1000)])
        self.tick(60)
        rows={r['channel']:r for r in self.stock.mapping()}
        for port,pulse in self.board.writes:
            self.assertEqual(pulse,self.stock.bound_pulse(rows[port-1],pulse))
        self.tick(10);self.assertFalse(self.stock.active)

    def test_live_pose_packet_ack_and_bounded_output_only_on_legs(self):
        ack=self.send(t='pose',lr='50,130',rid=1,seq=2,ts=3)
        self.assertTrue(ack['ok']);self.assertEqual(ack['seq'],2)
        self.tick(10)
        self.assertEqual({p-1 for p,v in self.board.writes},{1,2,3,5})
        for port,pulse in self.board.writes:
            c=self.channels.channels[port-1]
            self.assertLessEqual(min(c['a_us'],c['b_us']),pulse)
            self.assertLessEqual(pulse,max(c['a_us'],c['b_us']))

    def test_latest_wins_without_backlog_and_reaches_target_when_streamed(self):
        for _ in range(100):
            self.stock.pose(0,180);self.tick()
        self.assertEqual(self.stock.frames,[])
        for ch,pulse in self.stock.targets.items():self.assertEqual(self.channels.current[ch],pulse)
        self.stock.pose(180,0);self.tick()
        self.assertEqual(self.stock.last_lr,(180,0))

    def test_no_pose_silence_holds_forever(self):
        self.stock.pose(90,90);self.tick(26)
        self.assertFalse(self.stock.active);self.assertFalse(self.channels.owning)

    def test_gesture_and_wiggle_share_mapping_without_old_dog_routine(self):
        ack=self.send(t='act',rid=1,steps=[dict(l=50,r=130,ms=500)],mode='replace')
        self.assertTrue(ack['ok']);self.tick(30)
        self.assertEqual(self.stock.targets,self.stock.map_pose(50,130))
        self.tick(15);self.assertFalse(self.stock.active)
        ack=self.send(t='routine',rid=2,name='wiggle')
        self.assertTrue(ack['ok']);self.assertEqual(ack['queued_ms'],1500)
        self.tick(100);self.assertFalse(self.stock.active)

    def test_append_and_pose_preemption(self):
        self.stock.enqueue([dict(l=50,r=130,ms=500)])
        self.stock.enqueue([dict(l=90,r=90,ms=500)],'append')
        self.assertEqual(self.stock.queued_ms(),1000)
        self.stock.pose(95,90)
        self.assertEqual(self.stock.frames,[]);self.assertEqual(self.stock.mode,'pose')

    def test_bad_payloads_fail_without_pwm(self):
        for message in [dict(t='pose',lr='nan,90',rid=1),dict(t='pose',lr='90,90,90',rid=1),
                dict(t='act',steps=[dict(l=True,r=90,ms=500)]),
                dict(t='act',steps=[dict(l=90,r=90,ms=-1)]),dict(t='routine',name='unknown')]:
            self.assertFalse(self.send(**message)['ok'])
        self.assertEqual(self.board.writes,[])

    def test_missing_ambiguous_and_uncalibrated_mapping_are_rejected(self):
        self.channels.channels[1]['calibrated']=False
        with self.assertRaises(ValueError):self.stock.pose(90,90)
        self.channels.channels[1]['calibrated']=True
        self.channels.channels[10]['name']='Left front leg'
        with self.assertRaises(ValueError):self.stock.pose(90,90)
        self.assertEqual(self.board.writes,[])

    def test_named_walk_rejects_stock_interference(self):
        self.send(t='dog_cal',channel_action='walk_run',path_clear=True)
        before=list(self.board.writes)
        self.assertFalse(self.send(t='pose',lr='90,90',rid=1)['ok'])
        self.assertTrue(self.f.gait.running);self.assertEqual(before,self.board.writes)

    def test_manual_move_preempts_stock_without_replay(self):
        self.stock.pose(50,130);self.tick(2)
        self.channels.move([dict(channel=1,position='Down')])
        self.assertFalse(self.stock.active)
        self.tick(5);self.assertFalse(self.stock.active)

    def test_stop_clears_stream_and_gesture(self):
        self.stock.pose(90,90);self.tick(2)
        ack=self.send(t='dog_cal',channel_action='stop')
        self.assertTrue(ack['ok']);self.assertFalse(self.stock.active)
        before=len(self.board.writes);self.tick(30)
        self.assertEqual(len(self.board.writes),before)

    def test_slew_limit_for_large_input_jump(self):
        self.stock.pose(180,0);self.tick(10)
        for ch in (1,2,3,5):
            pulses=[p for port,p in self.board.writes if port==ch+1]
            self.assertTrue(all(abs(b-a)<=12 for a,b in zip(pulses,pulses[1:])))


if __name__=='__main__':unittest.main()
