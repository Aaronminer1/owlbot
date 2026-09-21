"""Host-only tests of actual relay functions: no imports or physical hardware."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=(Path(__file__).resolve().parents[1]/'firmware/pico/relay_chip.py').read_text(encoding='utf8')

class Stream:
    def __init__(self, incoming=b'', chunk=100000, fail=False):
        self.incoming=incoming; self.output=bytearray(); self.chunk=chunk
        self.closed=False; self.fail=fail
    def write(self,data):
        if self.fail:raise OSError('injected write fault')
        count=min(len(data),self.chunk);self.output.extend(data[:count]);return count
    def read(self,count):
        if self.fail:raise OSError('injected read fault')
        value=self.incoming[:min(count,self.chunk)];self.incoming=self.incoming[len(value):];return value
    def close(self):self.closed=True
    def settimeout(self,value):pass
    def connect(self,address):pass

def environment():
    tick=[0]
    def ticks():tick[0]+=1;return tick[0]
    env={'time':SimpleNamespace(ticks_ms=ticks,ticks_diff=lambda a,b:a-b),
         'feed':lambda:None,'os':SimpleNamespace(urandom=lambda n:bytes(range(n))),
         'NET_STAGE_MS':6000,'NET_TIMEOUT_S':6,'MAX_FRAME_BYTES':32768,'MAX_HANDSHAKE_BYTES':4096,
         'LINK_DIAG':{'stage':'boot','io':'idle','faults':[],'reset_radio':False,'radio_resets':0},
         'BOOT_MS':0,'WIFI_RESET_EVERY':3,'HOST':'test.invalid','PATH':'/test',
         'gc':SimpleNamespace(collect=lambda:None),'binascii':__import__('binascii')}
    names={'ws_open','check_net_budget','write_all','send_frame','send_text','recvn','_frame_after','ensure_wifi','wifi_reset','link_fault','radio_reset_required'}
    nodes=[n for n in ast.parse(SOURCE).body if isinstance(n,ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'relay network','exec'),env)
    return env

class RelayNetworkTests(unittest.TestCase):
    def test_fault_history_retains_original_and_is_bounded(self):
        env=environment();diag=env['LINK_DIAG']
        diag['stage']='serving';diag['io']='first_byte_read'
        env['link_fault']('read timeout')
        diag['stage']='tcp';diag['io']='connect';env['link_fault']('connect timeout')
        self.assertEqual(diag['faults'][0]['io'],'first_byte_read')
        self.assertEqual(diag['last_error_io'],'connect')
        for i in range(7):env['link_fault']('x'*200)
        self.assertEqual(len(diag['faults']),4)
        self.assertTrue(all(len(f['error'])==120 for f in diag['faults']))

    def test_receive_deadline_requests_radio_recovery_without_three_retries(self):
        env=environment()
        self.assertFalse(env['radio_reset_required'](1))
        self.assertFalse(env['radio_reset_required'](2))
        self.assertTrue(env['radio_reset_required'](3))
        env['LINK_DIAG']['reset_radio']=True
        self.assertTrue(env['radio_reset_required'](1))

    def test_failed_write_and_partial_frame_identify_correct_operation(self):
        env=environment()
        with self.assertRaises(OSError):env['write_all'](Stream(fail=True),b'x')
        env['link_fault']('failed write')
        self.assertEqual(env['LINK_DIAG']['last_error_io'],'write')
        with self.assertRaises(OSError):env['_frame_after'](Stream(b'\x03ab'),b'\x81')
        env['link_fault']('partial frame')
        self.assertEqual(env['LINK_DIAG']['last_error_io'],'frame_read')

    def test_stalled_join_resets_and_submits_a_new_connection(self):
        for initial in (0,1,2,-1,-2):
            env=environment();calls=[]
            class Radio:
                connected=False
                state=initial
                def active(self,on):calls.append(('active',on))
                def isconnected(self):return self.connected
                def status(self):return self.state
                def disconnect(self):calls.append(('disconnect',));self.state=0
                def config(self,**kw):pass
                def connect(self,*args):calls.append(('connect',));self.connected=True;self.state=3
                def ifconfig(self):return ('192.0.2.1',)
            env['wlan']=Radio();env['network']=SimpleNamespace(WLAN=SimpleNamespace(PM_NONE=0))
            env['sleep_fed']=lambda ms:None;env['time'].sleep_ms=lambda ms:None
            with patch.dict('sys.modules',{'secrets':SimpleNamespace(WIFI_SSID='test',WIFI_PASS='test')}):
                self.assertTrue(env['ensure_wifi']())
            self.assertEqual(calls.count(('connect',)),1)
            self.assertEqual(('disconnect',) in calls,initial!=0)

    def test_partial_writes_are_completed_and_masked(self):
        env=environment()
        for payload in (b'hello',b'a'*130,b'a'*16000):
            stream=Stream(chunk=73);env['send_frame'](stream,1,payload)
            encoded=bytes(stream.output);prefix=2 if len(payload)<126 else 4
            self.assertEqual(encoded[0],0x81);mask=encoded[prefix:prefix+4]
            decoded=bytes(b^mask[i%4] for i,b in enumerate(encoded[prefix+4:]))
            self.assertEqual(decoded,payload)

    def test_nonempty_ping_payload_can_be_echoed(self):
        env=environment();payload=b'heartbeat-123';stream=Stream(b'\x0d'+payload)
        op,data=env['_frame_after'](stream,b'\x89');self.assertEqual(op,9)
        env['send_frame'](stream,10,data);wire=bytes(stream.output)
        self.assertEqual(wire[0],0x8a);mask=wire[2:6]
        self.assertEqual(bytes(b^mask[i%4] for i,b in enumerate(wire[6:])),payload)
        tree=ast.parse(SOURCE);serve=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='serve')
        self.assertTrue(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='send_frame' and len(n.args)==3 and isinstance(n.args[1],ast.Constant) and n.args[1].value==10 and isinstance(n.args[2],ast.Name) and n.args[2].id=='pl' for n in ast.walk(serve)))

    def test_eof_and_oversized_frames_fail_bounded(self):
        env=environment()
        for wire in (b'',b'\x7e\x00',b'\x7e\xff\xff',b'\x03ab',b'\x7f'+b'\xff'*8):
            with self.assertRaises(OSError):env['_frame_after'](Stream(wire),b'\x81')
        with self.assertRaises(OSError):env['_frame_after'](Stream(b'\x02{}'),b'\x01')
        with self.assertRaises(OSError):env['write_all'](Stream(chunk=0),b'test')

    def test_slow_dribble_hits_total_deadline(self):
        env=environment();tick=[0]
        def ticks():tick[0]+=2000;return tick[0]
        env['time'].ticks_ms=ticks
        with self.assertRaisesRegex(OSError,'deadline'):env['recvn'](Stream(b'x'*40,chunk=1),40)

    def test_upgrade_closes_both_sockets_on_each_failure(self):
        for incoming,fail in ((b'',False),(b'HTTP/1.1 500 Error\r\n\r\n',False),(b'x'*4100,False),(b'',True)):
            env=environment();raw=Stream();tls=Stream(incoming,fail=fail)
            env['socket']=SimpleNamespace(getaddrinfo=lambda *a:[(None,None,None,None,('127.0.0.1',443))],socket=lambda:raw)
            env['ssl']=SimpleNamespace(wrap_socket=lambda *a,**kw:tls)
            with self.assertRaises(OSError):env['ws_open']()
            self.assertTrue(tls.closed);self.assertTrue(raw.closed)

    def test_upgrade_success_retains_sockets(self):
        env=environment();raw=Stream();tls=Stream(b'HTTP/1.1 101 Switching Protocols\r\n\r\n',chunk=7)
        env['socket']=SimpleNamespace(getaddrinfo=lambda *a:[(None,None,None,None,('127.0.0.1',443))],socket=lambda:raw)
        env['ssl']=SimpleNamespace(wrap_socket=lambda *a,**kw:tls)
        self.assertEqual(env['ws_open'](),(tls,raw));self.assertFalse(raw.closed);self.assertFalse(tls.closed)

if __name__=='__main__':unittest.main()
