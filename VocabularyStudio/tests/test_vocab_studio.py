import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'VocabularyStudio/app'))
from vocab_studio_data import Repository, FILES, parse_map, patch_object, properties, positions, undo_latest


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        for name in [*FILES.values(),'vocabulary-catalog.js']:
            shutil.copy2(ROOT/name,self.root/name)
        # Freeze the pilot inputs independently of the user's later imports/edits.
        from vocab_studio_data import objects, properties
        fixture={d['word']:d for d in json.loads((ROOT/'VocabularyStudio/tests/fixtures/pilot_entries.json').read_text(encoding='utf-8'))}
        path=self.root/'flashcard1.js';source=path.read_text(encoding='utf-8-sig')
        for start,end,raw in reversed(list(objects(source))):
            word=properties(raw)[1].get('word')
            if word in fixture:source=source[:start]+json.dumps(fixture[word],ensure_ascii=False)+source[end:]
        path.write_text(source,encoding='utf-8')
        (self.root/'VocabularyStudio/app').mkdir(parents=True);shutil.copy2(ROOT/'VocabularyStudio/app/validate-vocab-studio.cjs',self.root/'VocabularyStudio/app/validate-vocab-studio.cjs')
        (self.root/'visual/images').mkdir(parents=True)
        for image in (ROOT/'visual/images').glob('*.webp'):shutil.copy2(image,self.root/'visual/images'/image.name)
        self.repo=Repository(self.root)
        self.maps=json.loads((ROOT/'VocabularyStudio/tests/fixtures/vocab_studio_pilot.json').read_text(encoding='utf-8'))
        self.entries=self.repo.prepare(self.maps)

    def tearDown(self):self.temp.cleanup()

    def test_pilot_25_commit_undo_and_idempotence(self):
        self.assertEqual([e['image_id'] for e in self.entries],[f'{i:04}' for i in range(21,46)])
        original=(self.root/'flashcard1.js').read_bytes()
        for e in self.entries:e['sense_confirmed']=True
        each=next(e for e in self.entries if e['word']=='각');each['confirmed']=True
        changes,queue=self.repo.plan(self.entries)
        self.assertEqual(len(queue),25)
        self.repo.commit(changes)
        current=Repository(self.root)
        self.assertEqual(current.unique('topik1','각')['data']['sentenceAnswer'],'각')
        self.assertNotIn('sentenceAnswer',current.unique('topik1','가지다')['data'])
        self.assertEqual(current.unique('topik1','감다')['data']['imageId'],'0036')
        # Every other vocabulary object is byte-for-byte preserved.
        for key,records in self.repo.records.items():
            if key not in {(e['level'],e['word']) for e in self.entries}:
                self.assertEqual([r['raw'] for r in records],[r['raw'] for r in current.records[key]])
        again,_=current.plan(self.entries);self.assertEqual(again,{})
        undo_latest(self.root)
        self.assertEqual((self.root/'flashcard1.js').read_bytes(),original)
        self.assertTrue((self.root/'visual/images/0021.webp').exists())
        self.assertFalse((self.root/'VocabularyStudio/data/review_queue.json').exists())

    def test_unconfirmed_sense_only_queues_no_binding(self):
        changes,queue=self.repo.plan(self.entries)
        self.assertNotIn('flashcard1.js',changes)
        self.assertEqual(len(queue),25)
        self.assertTrue(all('review_image_sense' in q['reasons'] for q in queue))

    def test_external_edits_block_commit(self):
        changes,_=self.repo.plan(self.entries)
        with (self.root/'flashcard2.js').open('a',encoding='utf-8') as f:f.write('\n// external edit')
        with self.assertRaisesRegex(ValueError,'ภายนอก'):self.repo.commit(changes)

    def test_bad_answer_missing_image_and_collision(self):
        e=self.entries[0];e.update(sense_confirmed=True,confirmed=True,answer='wrong')
        with self.assertRaises(ValueError):self.repo.plan([e])
        e.update(confirmed=False,image_id='9999')
        with self.assertRaisesRegex(ValueError,'ไม่พบไฟล์'):self.repo.plan([e])
        e['image_id']='0021'
        with self.assertRaisesRegex(ValueError,'ไม่เขียนทับ'):self.repo.plan([e],{'visual/images/0021.webp':b'new image'})

    def test_property_preservation_and_boundaries(self):
        raw='{ word: "test", meaning: "ทดสอบ", sentenceAcceptedAnswers: ["a", "b"], custom: true }'
        output=patch_object(raw,{'imageId':'0021'})
        self.assertIn('sentenceAcceptedAnswers: ["a", "b"], custom: true',output)
        self.assertEqual(properties(output)[1]['imageId'],'0021')
        self.assertEqual(positions('good go go','go',True),[5,8])

    def test_undo_refuses_to_overwrite_later_edit(self):
        for e in self.entries:e['sense_confirmed']=True
        changes,_=self.repo.plan(self.entries);self.repo.commit(changes)
        with (self.root/'flashcard1.js').open('a',encoding='utf-8') as f:f.write('\n// later')
        with self.assertRaisesRegex(ValueError,'เปลี่ยนหลัง'):undo_latest(self.root)

    def test_transaction_rolls_back_on_write_failure(self):
        for e in self.entries:e['sense_confirmed']=True
        changes,_=self.repo.plan(self.entries)
        import vocab_studio_data as data
        original=data.write_atomic
        def failing(path,content):
            if str(path).endswith('review_queue.json'):raise OSError('simulated disk failure')
            return original(path,content)
        with patch.object(data,'write_atomic',side_effect=failing):
            with self.assertRaises(OSError):self.repo.commit(changes)
        self.assertEqual((self.root/'flashcard1.js').read_bytes(),self.repo.original['flashcard1.js'])

    def test_validation_rejects_invalid_js(self):
        with self.assertRaises(ValueError):self.repo.validate({'flashcard1.js':b'bad syntax !'})

    def test_selected_shared_image_words_only_roundtrip(self):
        from vocab_language_exchange import shared_image_candidates,build_request,parse_response
        # A fixed house example independent of future user vocabulary changes.
        repo=self.repo
        repo.records={('topik1','집'):[{'data':{'word':'집','meaning':'บ้าน','imageId':'0021'}}],
                      ('english_a1','house'):[{'data':{'word':'house','meaning':'บ้าน'}}],
                      ('english_a2','home'):[{'data':{'word':'home','meaning':'บ้าน'}}]}
        rows=shared_image_candidates(repo)
        self.assertEqual({r['targetKey'] for r in rows},{'english_a1:house','english_a2:home'})
        request,prompt=build_request(repo,selected_matches={'topik1:집':['english_a1:house']})
        self.assertIn('house',prompt);self.assertNotIn('home',prompt)
        good={'requestId':request['requestId'],'results':[{'key':'topik1:집','matches':[{'level':'english_a1','word':'house','sentence':'This is my house.','translate':'นี่คือบ้านของฉัน','sentenceAnswer':'house'}]}]}
        entries,_=parse_response(json.dumps(good,ensure_ascii=False),repo,request)
        self.assertEqual(entries[1]['image_id'],'0021');self.assertFalse(entries[1]['confirmed'])
        good['results'][0]['matches'][0].update(level='english_a2',word='home',sentence='This is my home.',sentenceAnswer='home')
        with self.assertRaisesRegex(ValueError,'ไม่ใช่คำที่คุณเลือก'):parse_response(json.dumps(good),repo,request)

    def test_preview_warns_for_partial_verb_but_not_noun_particle(self):
        from studio_review import answer_preview,meaning_choices
        entry=dict(level='topik1',word='가지다',sentence='돈을 가지고 있어요.',answer='가지',occurrence=1)
        preview,warning,whole=answer_preview(entry)
        self.assertIn('［_____］고',preview);self.assertTrue(warning);self.assertEqual(whole,'가지고')
        entry.update(answer='가지고');self.assertEqual(answer_preview(entry)[1],'')
        entry.update(word='돈',answer='돈');self.assertEqual(answer_preview(entry)[1],'')
        self.assertEqual(meaning_choices('หมา, อัน(ลักษณะนาม)'),['หมา','อัน(ลักษณะนาม)'])

    def test_saved_batch_history_uses_actual_journal(self):
        from studio_review import saved_batches,maps_for_ids
        for e in self.entries:e['sense_confirmed']=True
        changes,_=self.repo.plan(self.entries);self.repo.commit(changes)
        repo=Repository(self.root);history=saved_batches(repo)
        self.assertEqual(history[0]['ids'],[f'{i:04}' for i in range(21,46)])
        self.assertEqual(len(maps_for_ids(repo,set(history[0]['ids']))),25)

    def test_cutter_opens_folder_after_callback(self):
        import vocab_studio as studio
        root=studio.tk.Tk();root.withdraw()
        try:
            called=[];c=studio.cutter_module.Cutter(root,on_export=lambda file:called.append('review'))
            c.save_start=lambda value:None;c.open_folder=lambda:called.append('folder')
            c.set_busy(True);c.messages.put(('done','example.zip','0071',25));c.poll()
            self.assertEqual(called,['review','folder'])
        finally:root.destroy()

    def test_edit_sentence_translation_answer_then_clear_old_answer(self):
        e=self.entries[0]
        e.update(sentence='책을 가지고 있어요.',translate='ฉันมีหนังสืออยู่',answer='가지고',confirmed=True,sense_confirmed=True)
        changes,_=self.repo.plan([e]);self.repo.commit(changes)
        repo=Repository(self.root);data=repo.unique('topik1','가지다')['data']
        self.assertEqual(data['sentense'],'책을 가지고 있어요.')
        self.assertEqual(data['translate'],'ฉันมีหนังสืออยู่')
        self.assertEqual(data['sentenceAnswer'],'가지고')
        e.update(sentence='가방을 가지고 있어요.',confirmed=False)
        changes,_=repo.plan([e]);repo.commit(changes)
        data=Repository(self.root).unique('topik1','가지다')['data']
        self.assertNotIn('sentenceAnswer',data)
        self.assertEqual(data['sentense'],'가방을 가지고 있어요.')

    def test_delete_answer_metadata_preserves_other_properties(self):
        from vocab_studio_data import REMOVE
        raw='{ word:"x", meaning:"y", sentenceAnswer:"x", sentenceOccurrence:2, sentenceAcceptedAnswers:["a"], custom:true }'
        value=patch_object(raw,{k:REMOVE for k in ['sentenceAnswer','sentenceOccurrence','sentenceAcceptedAnswers']})
        self.assertEqual(properties(value)[1],{'word':'x','meaning':'y'})
        self.assertIn('custom:true',value)

    def make_language_request(self):
        from vocab_language_exchange import build_request
        for e in self.entries:e['sense_confirmed']=True
        changes,_=self.repo.plan(self.entries);self.repo.commit(changes)
        repo=Repository(self.root)
        request,prompt=build_request(repo,allow_new=True)
        self.assertIn('requestId',prompt)
        return repo,request

    def test_chat_roundtrip_add_new_word_and_undo(self):
        from vocab_language_exchange import parse_response
        repo,request=self.make_language_request()
        response={'requestId':request['requestId'],'results':[{'key':'topik1:가지다',
                  'sentence':'책을 가지고 있어요.','translate':'ฉันมีหนังสืออยู่','sentenceAnswer':'가지고',
                  'matches':[{'level':'english_a2','word':'studio-test-possession','meaning':'มี, ครอบครอง',
                              'sentence':'This is studio-test-possession.','translate':'นี่คือการครอบครอง',
                              'sentenceAnswer':'studio-test-possession','note':'test fixture'}]}]}
        entries,notes=parse_response('```json\n'+json.dumps(response,ensure_ascii=False)+'\n```',repo,request)
        self.assertEqual(len(entries),2);self.assertTrue(entries[1]['is_new'])
        self.assertFalse(entries[0]['confirmed'])
        for e in entries:e.update(sense_confirmed=True,confirmed=True)
        changes,queue=repo.plan(entries);repo.commit(changes)
        latest=Repository(self.root)
        self.assertEqual(latest.unique('english_a2','studio-test-possession')['data']['imageId'],'0021')
        self.assertFalse(any(q['key']=='topik1:가지다' for q in queue))
        self.assertEqual(len(queue),24)
        undo_latest(self.root)
        self.assertNotIn(('english_a2','studio-test-possession'),Repository(self.root).records)

    def test_chat_rejects_wrong_ids_fields_duplicates_and_stale_snapshot(self):
        from vocab_language_exchange import parse_response
        repo,request=self.make_language_request()
        good={'requestId':request['requestId'],'results':[{'key':'topik1:가지다','note':'ไม่แน่ใจ'}]}
        for bad in [dict(good,requestId='wrong'),
                    dict(good,results=[{'key':'topik1:가지다','imageId':'9999'}]),
                    dict(good,results=[{'key':'topik1:ไม่มีคำนี้'}]),
                    dict(good,results=[{'key':'topik1:가지다','sentence':'abc','sentenceAnswer':'xyz'}])]:
            with self.assertRaises(ValueError):parse_response(json.dumps(bad),repo,request)
        duplicate='{"requestId":"x","requestId":"y","results":[]}'
        with self.assertRaises(ValueError):parse_response(duplicate,repo,request)
        with (self.root/'flashcard1.js').open('a',encoding='utf-8') as f:f.write('\n// changed')
        with self.assertRaisesRegex(ValueError,'เปลี่ยน'):parse_response(json.dumps(good),Repository(self.root),request)

    def test_chat_reuses_existing_counterpart(self):
        from vocab_language_exchange import parse_response
        repo,request=self.make_language_request()
        response={'requestId':request['requestId'],'results':[{'key':'topik1:각',
                  'matches':[{'level':'english_a1','word':'each','meaning':'แต่ละ'}]}]}
        entries,_=parse_response(json.dumps(response),repo,request)
        self.assertFalse(entries[1].get('is_new',False))
        self.assertEqual(entries[1]['word'],'each')

    def test_gui_edit_select_answer_and_save_one_row(self):
        import vocab_studio as studio
        root=studio.tk.Tk();root.withdraw()
        try:
            app=studio.Studio(root,self.root);app.set_batch(self.maps);root.update()
            app.sentence.delete('1.0','end');app.sentence.insert('1.0','책을 가지고 있어요.')
            root.update()
            app.translation.set('ฉันมีหนังสืออยู่')
            app.sentence.tag_add('sel','1.3','1.6');app.use_selection()
            self.assertEqual(app.answer.get(),'가지고')
            app.meaning.set('มี');app.answer_ok.set(True);app.sense_ok.set(True)
            with patch.object(studio.messagebox,'askyesno',return_value=True),patch.object(studio.messagebox,'showinfo'):
                app.save(True)
            self.assertEqual(Repository(self.root).unique('topik1','가지다')['data']['sentense'],'책을 가지고 있어요.')
            self.assertNotIn('imageId',Repository(self.root).unique('topik1','각')['data'])
        finally:root.destroy()

    def test_bulk_answer_confirmation_skips_incomplete_and_saves_simple_records(self):
        import vocab_studio as studio
        root=studio.tk.Tk();root.withdraw()
        try:
            app=studio.Studio(root,self.root);app.set_batch(self.maps);root.update()
            # One blank conjugation, one invalid answer and one missing translation.
            app.entries[1]['answer']='not in sentence'
            app.entries[2]['translate']=''
            before=(self.root/'flashcard1.js').read_bytes()
            with patch.object(studio.messagebox,'askyesno',return_value=True):
                app.confirm_senses();app.confirm_answers()
            self.assertFalse(app.entries[0]['confirmed'])
            self.assertFalse(app.entries[1]['confirmed'])
            self.assertFalse(app.entries[2]['confirmed'])
            self.assertTrue(next(e for e in app.entries if e['word']=='간식')['confirmed'])
            self.assertEqual((self.root/'flashcard1.js').read_bytes(),before)
            with patch.object(studio.messagebox,'askyesno',return_value=True),patch.object(studio.messagebox,'showinfo'):
                app.save()
            data=Repository(self.root).unique('topik1','간식')['data']
            self.assertEqual(data['sentenceAnswer'],'간식')
            self.assertEqual(set(data),{'word','meaning','sentense','translate','imageId','sentenceAnswer'})
        finally:root.destroy()

    def test_gui_pilot_and_cutter_bridge(self):
        import vocab_studio as studio
        root=studio.tk.Tk();root.withdraw()
        try:
            app=studio.Studio(root,self.root)
            app.set_batch(self.maps);root.update()
            self.assertEqual(len(app.tree.get_children()),25)
            app.sense_ok.set(True);app.apply_edit()
            self.assertTrue(app.entries[0]['sense_confirmed'])
            app.code.insert('1.0','\n'.join(json.dumps(app.repo.unique(e['level'],e['word'])['data'],ensure_ascii=False)+',' for e in self.entries))
            app.send_to_cutter()
            self.assertEqual(len(app.cutter.parse_words(app.cutter.words.get('1.0','end'))),25)
            self.assertEqual(app.cutter.rows.get(),5)
            # Export a synthetic 5x5 sheet and import its real ZIP into review.
            output=self.root/'test.zip'
            app.cutter.worker(str(output),studio.Image.new('RGB',(100,100),'white'),
                              [0,20,40,60,80,100],[0,20,40,60,80,100],32,False,'',21,4,
                              app.cutter.parse_words(app.cutter.words.get('1.0','end')))
            app.load_zip(output,True)
            self.assertEqual(len(app.assets),25)
            self.assertEqual(app.entries[-1]['image_id'],'0045')
        finally:root.destroy()


if __name__=='__main__':unittest.main()
