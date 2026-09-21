import json
import unittest
from test_named_gait import NamedWalkTests
from named_turn import NamedTurn

class TurnTests(unittest.TestCase):
    def setUp(self):
        NamedWalkTests.setUp(self)
        c=self.channels.channels[7].copy();c['locked']=False;self.channels.configure(c)
        c.update(name='Turn',enabled=True,calibrated=True,a_name='Closed',b_name='Open',a_us=1515,b_us=1019,center_us=1267)
        self.channels.configure(c)
        self.binding={k:c[k] for k in ('name','a_name','b_name','a_us','b_us','center_us')}
        self.plan.update(lift_percent=50,speed_us_s=400)
        self.turn=NamedTurn(self.channels)
    tearDown=NamedWalkTests.tearDown
    bound=NamedWalkTests.bound
    def tick(self,n=1,heartbeat=True):
        for i in range(n):
            self.now+=20
            if heartbeat and self.turn.running:self.turn.keepalive(self.turn.run_id)
            self.channels.step();self.turn.step()
    def test_exact_pairs_and_minimum_return_preserve_walk(self):
        before=json.dumps(self.plan);calls=[];move=self.channels.move
        def record(targets,**kwargs):
            calls.append((targets,kwargs));return move(targets,**kwargs)
        self.channels.move=record
        self.turn.start_turn(self.plan,7,self.binding)
        self.tick(1000)
        self.assertIsNone(self.turn.error);self.assertFalse(self.turn.running)
        phases=calls[5:]
        self.assertEqual([[t['channel'] for t in targets] for targets,kw in phases],[[5,2],[7],[5,2],[1,3],[7],[1,3]])
        self.assertEqual([kw['parallel'] for targets,kw in phases],[True,False,True,True,False,True])
        self.assertEqual(phases[0][0][0]['pulse_us'],1500)
        self.assertEqual(self.channels.current[7],1515)
        self.assertTrue(all(self.channels.current[ch]==1550 for ch in (1,2,3,5)))
        self.assertEqual(before,json.dumps(self.plan));self.assertEqual(self.turn.status()['completed_cycles'],1)
    def test_opposite_swaps_diagonals_and_still_closes(self):
        self.turn.start_turn(self.plan,7,self.binding,'b')
        self.assertEqual([s['channel'] for s in self.turn.sequence],[1,3,7,1,3,5,2,7,5,2])
        self.assertEqual(self.turn.sequence[2]['position'],'Open')
        self.assertEqual(self.turn.sequence[7]['position'],'Closed')
        self.tick(1000);self.assertEqual(self.channels.current[7],1515)
        self.assertIsNone(self.turn.error)
    def test_small_turn_both_directions_preserves_endpoints_and_closes(self):
        for pattern in ('a','b'):
            before=json.dumps(self.channels.channels);calls=[];move=self.channels.move
            def record(targets,**kwargs):
                calls.extend(targets);return move(targets,**kwargs)
            self.channels.move=record
            self.turn.start_turn(self.plan,7,self.binding,pattern,.08)
            self.tick(1000)
            self.channels.move=move
            turn_calls=[x for x in calls if x['channel']==7]
            self.assertEqual([x.get('position') for x in turn_calls],['Closed',None,'Closed'])
            self.assertEqual(turn_calls[1]['pulse_us'],1475)
            self.assertEqual(self.channels.current[7],1515)
            self.assertEqual(self.turn.status()['turn_fraction'],.08)
            self.assertEqual(before,json.dumps(self.channels.channels))
    def test_bad_fraction_never_emits_pwm(self):
        for value in (0,-1,1.1,True,'0.08',float('nan'),float('inf')):
            with self.assertRaises(ValueError):self.turn.start_turn(self.plan,7,self.binding,'a',value)
        self.assertEqual(self.board.writes,[])
    def test_walk_reengages_closed_before_slide_without_turning(self):
        self.gait.save(self.plan);calls=[];move=self.channels.move
        def record(targets,**kwargs):
            calls.extend(targets);return move(targets,**kwargs)
        self.channels.move=record
        self.gait.start(path_clear=True)
        for _ in range(1000):
            self.now+=20;self.channels.step();self.gait.step()
        turn=[x for x in calls if x['channel']==7]
        self.assertEqual(turn,[dict(channel=7,position='Closed')])
        self.assertLess(next(i for i,x in enumerate(calls) if x['channel']==7),next(i for i,x in enumerate(calls) if x['channel']==6))
        self.assertEqual(self.channels.current[7],1515)
    def test_ambiguous_endpoints_rejected(self):
        self.channels.channels[7]['a_name']='Left';self.binding['a_name']='Left'
        with self.assertRaises(ValueError):self.turn.start_turn(self.plan,7,self.binding)
        self.assertEqual(self.board.writes,[])
    def test_stale_binding_rejected_before_pwm(self):
        self.binding['a_us']=1600
        with self.assertRaises(ValueError):self.turn.start_turn(self.plan,7,self.binding)
        self.assertEqual(self.board.writes,[])
    def test_cannot_use_slide_for_turn(self):
        with self.assertRaises(ValueError):self.turn.start_turn(self.plan,6,self.binding)
        self.assertEqual(self.board.writes,[])
    def test_stop_never_restarts(self):
        self.turn.start_turn(self.plan,7,self.binding);self.tick(10);self.turn.cancel()
        count=len(self.board.writes);self.tick(500);self.assertEqual(count,len(self.board.writes))
    def test_lost_phone_stops_cycle(self):
        self.turn.start_turn(self.plan,7,self.binding);self.tick(160,heartbeat=False)
        self.assertFalse(self.turn.running);self.assertEqual(self.turn.error,'turn_control_timed_out')

if __name__=='__main__':unittest.main()
