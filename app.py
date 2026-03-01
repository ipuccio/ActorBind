import os
import re
import json
import uuid
import random
import difflib
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.secret_key = os.urandom(24).hex()

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory storage for parsed plays
plays_store = {}


# ─── PDF & Parsing ────────────────────────────────────────────────────────────

def extract_text_from_pdf(filepath, start_page=None, end_page=None):
    """Extract text from a PDF file, optionally within a page range."""
    import pdfplumber
    text = ""
    with pdfplumber.open(filepath) as pdf:
        total_pages = len(pdf.pages)
        start = (start_page or 1) - 1
        end = min((end_page or total_pages), total_pages)
        for i in range(start, end):
            page_text = pdf.pages[i].extract_text()
            if page_text:
                text += page_text + "\n"
    return text, total_pages


def clean_dialogue_text(text):
    """Remove stage directions and clean up whitespace."""
    text = re.sub(r'\(([^)]*)\)', '', text)
    text = re.sub(r'\[([^\]]*)\]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def parse_play_dialogue(text):
    """Parse play text into structured dialogue entries."""
    lines = text.split('\n')
    dialogue = []

    # Pattern: CHARACTER NAME: dialogue  or  CHARACTER NAME. dialogue
    inline_pattern = re.compile(
        r'^([A-Z][A-Z\s\.\'\-]{0,28}[A-Z\.\'])\s*[\.:]\s*(.*\S.*)'
    )
    # Pattern: CHARACTER NAME alone on a line
    standalone_pattern = re.compile(r'^([A-Z][A-Z\s\.\'\-]{0,28}[A-Z\.\'])$')

    skip_words = {
        'ACT', 'SCENE', 'EXIT', 'ENTER', 'EXEUNT', 'END', 'CURTAIN',
        'BLACKOUT', 'LIGHTS', 'FADE', 'INTERMISSION', 'PROLOGUE',
        'EPILOGUE', 'CONTINUED', 'CONT', 'CUT TO', 'INT', 'EXT',
        'THE END', 'FINIS',
    }

    current_char = None
    current_line_parts = []

    def save_current():
        nonlocal current_char, current_line_parts
        if current_char and current_line_parts:
            text = ' '.join(current_line_parts).strip()
            text = clean_dialogue_text(text)
            if text:
                dialogue.append({
                    "character": current_char,
                    "line": text,
                })
        current_line_parts = []

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped:
            continue

        # Check inline pattern: NAME: dialogue
        m = inline_pattern.match(stripped)
        if m:
            name = m.group(1).strip().rstrip('.')
            rest = m.group(2).strip()
            if name.upper() not in skip_words and len(name) >= 2:
                save_current()
                current_char = name
                if rest:
                    current_line_parts = [rest]
                continue

        # Check standalone character name
        if len(stripped) <= 30:
            sm = standalone_pattern.match(stripped)
            if sm:
                name = sm.group(1).strip().rstrip('.')
                if name.upper() not in skip_words and len(name) >= 2:
                    save_current()
                    current_char = name
                    continue

        # Continuation of current character's dialogue
        if current_char:
            current_line_parts.append(stripped)

    save_current()
    return dialogue


def get_characters(dialogue):
    """Extract unique character names with line counts."""
    char_counts = {}
    for entry in dialogue:
        char = entry['character']
        char_counts[char] = char_counts.get(char, 0) + 1
    return [
        {"name": c, "line_count": n}
        for c, n in sorted(char_counts.items(), key=lambda x: -x[1])
        if n >= 1
    ]


def get_character_lines_with_cues(dialogue, character):
    """Return (cue, response) pairs for a character."""
    pairs = []
    for i, entry in enumerate(dialogue):
        if entry['character'].upper() == character.upper():
            cue = None
            cue_character = None
            for j in range(i - 1, -1, -1):
                if dialogue[j]['character'].upper() != character.upper():
                    cue = dialogue[j]['line']
                    cue_character = dialogue[j]['character']
                    break
            pairs.append({
                "index": len(pairs),
                "cue": cue or "(Scene begins — your line opens the scene)",
                "cue_character": cue_character or "NARRATOR",
                "line": entry['line'],
                "character": entry['character'],
            })
    return pairs


# ─── Exercise Generation ─────────────────────────────────────────────────────

def generate_exercises(line_pairs, all_lines_for_distractors=None):
    """Generate a progressive set of exercises for a list of line pairs."""
    if not line_pairs:
        return []

    distractors = all_lines_for_distractors or line_pairs
    exercises = []

    for pair in line_pairs:
        line = pair['line']
        words = line.split()

        if len(words) < 2:
            exercises.append(_make_full_recall(pair, difficulty=1))
            continue

        # 1) Multiple Choice  — difficulty 1
        exercises.append(_make_multiple_choice(pair, distractors))

        # 2) Fill in the Blanks — difficulty 2
        if len(words) >= 3:
            exercises.append(_make_fill_blank(pair))

        # 3) Word Scramble — difficulty 2
        if 3 <= len(words) <= 20:
            exercises.append(_make_word_scramble(pair))

        # 4) First Letters — difficulty 3
        if len(words) >= 3:
            exercises.append(_make_first_letters(pair))

        # 5) Full Recall — difficulty 4
        exercises.append(_make_full_recall(pair, difficulty=4))

    # Order: round-robin by difficulty across all lines
    by_line = {}
    for ex in exercises:
        by_line.setdefault(ex['line_index'], []).append(ex)

    ordered = []
    max_rounds = max((len(v) for v in by_line.values()), default=0)
    for r in range(max_rounds):
        for idx in sorted(by_line.keys()):
            if r < len(by_line[idx]):
                ordered.append(by_line[idx][r])

    return ordered


def _base(pair, etype, difficulty):
    return {
        "type": etype,
        "difficulty": difficulty,
        "cue": pair['cue'],
        "cue_character": pair['cue_character'],
        "your_character": pair['character'],
        "correct": pair['line'],
        "line_index": pair['index'],
    }


def _make_multiple_choice(pair, all_pairs):
    ex = _base(pair, "multiple_choice", 1)
    other = [p['line'] for p in all_pairs if p['line'] != pair['line']]
    if len(other) >= 3:
        wrong = random.sample(other, 3)
    else:
        wrong = other + _generate_wrong(pair['line'], 3 - len(other))
    options = wrong + [pair['line']]
    random.shuffle(options)
    ex['options'] = options
    ex['correct_index'] = options.index(pair['line'])
    return ex


def _generate_wrong(correct, count):
    words = correct.split()
    results = []
    for _ in range(count):
        m = words.copy()
        if len(m) > 2:
            i, j = random.sample(range(len(m)), 2)
            m[i], m[j] = m[j], m[i]
        results.append(' '.join(m))
    return results


def _make_fill_blank(pair):
    ex = _base(pair, "fill_blank", 2)
    words = pair['line'].split()
    num_blanks = max(1, len(words) // 3)
    content = [i for i, w in enumerate(words) if len(w) > 2]
    if not content:
        content = list(range(len(words)))
    indices = sorted(random.sample(content, min(num_blanks, len(content))))

    template, blanks = [], []
    for i, w in enumerate(words):
        if i in indices:
            template.append("____")
            clean = re.sub(r'[^\w]', '', w)
            blanks.append({"index": i, "answer": clean, "display": w})
        else:
            template.append(w)

    ex['template'] = ' '.join(template)
    ex['blanks'] = blanks
    return ex


def _make_word_scramble(pair):
    ex = _base(pair, "word_scramble", 2)
    words = pair['line'].split()
    scrambled = words.copy()
    for _ in range(20):
        random.shuffle(scrambled)
        if scrambled != words:
            break
    ex['scrambled'] = scrambled
    ex['correct_words'] = words
    return ex


def _make_first_letters(pair):
    ex = _base(pair, "first_letters", 3)
    words = pair['line'].split()
    hints = []
    for w in words:
        if not w:
            hints.append('')
            continue
        first = w[0]
        trailing = ''
        if len(w) > 1 and w[-1] in '.,!?;:\'")-':
            trailing = w[-1]
        body_len = len(w) - 1 - len(trailing)
        hints.append(first + '\u2022' * max(body_len, 0) + trailing)
    ex['hint'] = ' '.join(hints)
    return ex


def _make_full_recall(pair, difficulty=4):
    return _base(pair, "full_recall", difficulty)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_pdf():
    if 'pdf' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['pdf']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({"error": "File must be a PDF"}), 400

    play_id = str(uuid.uuid4())[:8]
    filepath = os.path.join(UPLOAD_FOLDER, f"{play_id}.pdf")
    file.save(filepath)

    try:
        text, total_pages = extract_text_from_pdf(filepath)
        if not text.strip():
            return jsonify({"error": "Could not extract text. The PDF may be scanned/image-based."}), 400

        dialogue = parse_play_dialogue(text)
        if not dialogue:
            return jsonify({"error": "No dialogue detected. Ensure the script uses CHARACTER NAME: format."}), 400

        characters = get_characters(dialogue)
        plays_store[play_id] = {
            "filepath": filepath,
            "total_pages": total_pages,
            "dialogue": dialogue,
            "characters": characters,
        }

        return jsonify({
            "play_id": play_id,
            "total_pages": total_pages,
            "characters": characters,
            "dialogue_count": len(dialogue),
            "preview": dialogue[:5],
        })

    except Exception as e:
        return jsonify({"error": f"Error processing PDF: {str(e)}"}), 500


@app.route('/api/exercises', methods=['POST'])
def create_exercises():
    data = request.json or {}
    play_id = data.get('play_id')
    character = data.get('character')
    start_page = data.get('start_page', 1)
    end_page = data.get('end_page')
    lesson_number = data.get('lesson_number', 0)
    lesson_size = data.get('lesson_size', 5)
    line_indices = data.get('line_indices')  # optional: redo specific lines

    if play_id not in plays_store:
        return jsonify({"error": "Play not found. Please upload again."}), 404

    play = plays_store[play_id]

    # Re-extract if page range specified
    if start_page or end_page:
        text, _ = extract_text_from_pdf(
            play['filepath'],
            start_page=start_page,
            end_page=end_page,
        )
        dialogue = parse_play_dialogue(text)
    else:
        dialogue = play['dialogue']

    all_pairs = get_character_lines_with_cues(dialogue, character)
    if not all_pairs:
        return jsonify({"error": f"No lines found for {character} in the selected range."}), 404

    # Specific lines (retry mode)
    if line_indices is not None:
        lesson_lines = [p for p in all_pairs if p['index'] in line_indices]
    else:
        start = lesson_number * lesson_size
        end_idx = start + lesson_size
        lesson_lines = all_pairs[start:end_idx]

    if not lesson_lines:
        return jsonify({"error": "No more lines to practice!"}), 404

    exercises = generate_exercises(lesson_lines, all_pairs)
    total_lessons = max(1, (len(all_pairs) + lesson_size - 1) // lesson_size)

    return jsonify({
        "exercises": exercises,
        "total_lines": len(all_pairs),
        "lesson_lines": len(lesson_lines),
        "total_lessons": total_lessons,
        "current_lesson": lesson_number,
        "character": character,
        "line_pairs": lesson_lines,
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
