"""Synthetic sample parity only; no Torch, actual media, services or model."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('audio_edits_fixture',Path(__file__).resolve().parents[1]/'comfy_nodes/StemStudio/audio_edits.py')
edits=importlib.util.module_from_spec(spec);spec.loader.exec_module(edits)
class EditsTests(unittest.TestCase):
    def test_trim_gain_and_silence_keep_full_length_and_channels(self):
        wave=np.ones((2,100),dtype=np.float32)
        value={'clips':[{'start':0,'end':2},{'start':4,'end':8}],'gains':[{'start':1,'end':5,'db':20}]}
        actual=edits.edit_array(wave,10,value)
        expected=np.zeros((2,100),dtype=np.float32)
        expected[:,:10]=1;expected[:,10:20]=10;expected[:,40:50]=10;expected[:,50:80]=1
        np.testing.assert_array_equal(actual,expected);np.testing.assert_array_equal(wave,np.ones_like(wave))
    def test_split_without_trimming_is_sample_identical(self):
        wave=np.arange(101,dtype=np.float32).reshape(1,-1)
        actual=edits.edit_array(wave,10,{'clips':[{'start':0,'end':3.25},{'start':3.25,'end':10.1}],'gains':[]})
        np.testing.assert_array_equal(actual,wave)
    def test_invalid_gain_and_overlap_fail(self):
        with self.assertRaises(ValueError):edits.parse_edits({'clips':[{'start':0,'end':4},{'start':2,'end':5}],'gains':[]},10)
        with self.assertRaises(ValueError):edits.parse_edits({'clips':[],'gains':[{'start':0,'end':1,'db':50}]},10)
    def test_moved_clip_plays_its_source_part_at_the_new_time_with_gain_on_the_timeline(self):
        wave=np.arange(100,dtype=np.float32).reshape(1,-1)+1
        value={'clips':[{'start':0,'end':2,'offset':3}],'gains':[{'start':4,'end':5,'db':6.0206}]}
        actual=edits.edit_array(wave,10,value)
        expected=np.zeros((1,100),dtype=np.float32)
        expected[0,30:50]=wave[0,0:20]
        expected[0,40:50]*=10**(6.0206/20)
        np.testing.assert_allclose(actual,expected,rtol=1e-5)
        np.testing.assert_array_equal(wave,np.arange(100,dtype=np.float32).reshape(1,-1)+1)
    def test_clips_cannot_overlap_after_moving_or_leave_the_timeline(self):
        with self.assertRaises(ValueError):edits.parse_edits({'clips':[{'start':0,'end':4,'offset':2},{'start':3,'end':5}],'gains':[]},10)
        with self.assertRaises(ValueError):edits.parse_edits({'clips':[{'start':1,'end':4,'offset':-2}],'gains':[]},10)
        with self.assertRaises(ValueError):edits.parse_edits({'clips':[{'start':0,'end':4,'offset':float('nan')}],'gains':[]},10)
        edits.parse_edits({'clips':[{'start':0,'end':2,'offset':3},{'start':6,'end':8}],'gains':[]},10)
