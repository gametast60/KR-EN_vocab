import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('builder', ROOT / 'VocabularyStudio/app/vocab_prompt_builder.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PromptTests(unittest.TestCase):
    def test_unicode_escapes_comments_and_braces(self):
        entries = builder.parse_entries('''// ignored { }
        { word: "가게", meaning: "ร้านค้า", sentense: "A \\"shop\\" {here} // yes" },
        { word: 'price', meaning: 'ราคา' },''')
        self.assertEqual(entries[0]['sentense'], 'A "shop" {here} // yes')
        self.assertEqual(entries[1]['meaning'], 'ราคา')

    def test_incomplete_and_executable_values_rejected(self):
        for text in ('{word:"a", meaning:"b"', '{word:danger(), meaning:"b"}', '{word:"a"}'):
            with self.assertRaises(ValueError):
                builder.parse_entries(text)

    def test_counts_and_order_without_sentences(self):
        entries = [{'word': str(i), 'meaning': 'ความหมาย', 'sentense': 'บริบทเกาหลี',
                    'sentence': 'English context', 'translate': 'คำแปลประโยค'} for i in range(25)]
        prompt, cutter = builder.make_outputs(entries)
        self.assertIn('5 columns × 5 rows', prompt)
        for excluded in ('บริบทเกาหลี', 'English context', 'คำแปลประโยค', 'Context only:'):
            self.assertNotIn(excluded, prompt)
        self.assertIn('VOCABULARY LIST\n' + cutter + '\n', prompt)
        self.assertEqual(len(cutter.splitlines()), 25)
        self.assertEqual(cutter.splitlines()[-1], '25. 24 / ความหมาย')
        self.assertNotIn('{N}', prompt)
        with self.assertRaises(ValueError):
            builder.make_outputs(entries[:6])

    def test_candidates_are_sense_matches_not_substrings(self):
        catalog = {'english_a1': [{'word': 'price', 'meaning': 'ราคา, มูลค่า'},
                                   {'word': 'cheap', 'meaning': 'ราคาถูก'}]}
        result = builder.candidates([{'word': '가격', 'meaning': 'ราคา'}], catalog)
        self.assertIn('english_a1:price', result)
        self.assertNotIn('english_a1:cheap', result)

    def test_actual_catalog_and_cutter_compatibility(self):
        catalog = builder.load_catalog()
        self.assertEqual(len(catalog), 6)
        entries = catalog['topik1'][:25]
        _, output = builder.make_outputs(entries)
        cutter_path = ROOT / 'VocabularyStudio/app/cutter.py'
        cutter_spec = importlib.util.spec_from_file_location('cutter', cutter_path)
        cutter = importlib.util.module_from_spec(cutter_spec)
        cutter_spec.loader.exec_module(cutter)
        parsed = cutter.Cutter.parse_words(output)
        self.assertEqual([row[0] for row in parsed], [entry['word'] for entry in entries])
        self.assertEqual(len(parsed), 25)
        new_entries = [e for e in catalog['topik1'] if not e.get('imageId')][:25]
        # Live data can advance to entries containing delimiter characters.
        # Such batches must fail closed rather than silently splitting a word.
        if any('/' in e['word'] for e in new_entries):
            with self.assertRaises(ValueError):builder.make_outputs(new_entries)
        else:
            _, new_output = builder.make_outputs(new_entries)
            self.assertEqual(len(cutter.Cutter.parse_words(new_output)), 25)


if __name__ == '__main__':
    unittest.main()
