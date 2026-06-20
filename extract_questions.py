#!/usr/bin/env python3
"""
YourQuiz — PDF Question Extractor
Extracts questions from medical science PDFs using OCR (Tesseract + PyMuPDF).
Outputs a JavaScript file (questions_extracted.js) with structured question data.
"""

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io
import re
import json
import sys
import os

# ============================================
# CONFIGURATION
# ============================================
PDF_FILES = {
    'biochemistry': 'Biochemistry_ed8 #yourwish.pdf',
    'anatomy': 'Anatomy_ed8 #yourwish.pdf',
    'physiology': 'Physiology_ed8 #yourwish.pdf'
}

SUBJECT_META = {
    'biochemistry': {'name': 'Biochemistry', 'icon': '🧬'},
    'anatomy': {'name': 'Anatomy', 'icon': '🦴'},
    'physiology': {'name': 'Physiology', 'icon': '❤️'}
}

DPI = 250  # Balance between quality and speed

# ============================================
# OCR EXTRACTION
# ============================================
def ocr_page(page):
    """Render a PDF page and OCR it."""
    pix = page.get_pixmap(dpi=DPI)
    img = Image.open(io.BytesIO(pix.tobytes('png')))
    text = pytesseract.image_to_string(img)
    return text


def extract_text_from_pdf(filepath):
    """Extract all text from a PDF using OCR, page by page."""
    pdf = fitz.open(filepath)
    total_pages = len(pdf)
    all_text = []
    
    for i in range(total_pages):
        page = pdf[i]
        text = ocr_page(page)
        all_text.append(text)
        
        # Progress
        if (i + 1) % 10 == 0 or i == total_pages - 1:
            print(f"  OCR progress: {i+1}/{total_pages} pages", flush=True)
    
    pdf.close()
    return all_text


# ============================================
# PARSING
# ============================================
def find_sections(pages_text):
    """
    Split the full text into sections. Each section has:
    - A chapter title (text before "Question 1:")
    - Questions
    - An Answer Key
    - Solutions/Explanations
    """
    full_text = "\n\n".join(pages_text)
    
    # Remove "Sold by @itachibot" watermarks
    full_text = re.sub(r'\d+\s*Sold by @itachibot', '', full_text)
    full_text = re.sub(r'Sold by @itachibot', '', full_text)
    
    # Split by "Answer Key" markers to find section boundaries
    # Each section: chapter title + questions + answer key + solutions
    sections = re.split(r'(?=Answer Key)', full_text)
    
    # Group: questions before "Answer Key" + answer key + solutions
    result = []
    i = 0
    
    # First section contains the very first batch of questions (before first Answer Key)
    # Subsequent sections start with "Answer Key"
    
    # Let's try a different approach: find all "Question 1:" markers
    # Each chapter starts with a title and "Question 1:"
    q1_pattern = re.compile(r'\n(?:Question\s+1\s*[:.])', re.IGNORECASE)
    
    # Find all chapter starts
    chapter_starts = []
    for m in q1_pattern.finditer(full_text):
        chapter_starts.append(m.start())
    
    # For each chapter, find the text from Q1 to the next Q1
    for ci, start in enumerate(chapter_starts):
        end = chapter_starts[ci + 1] if ci + 1 < len(chapter_starts) else len(full_text)
        chunk = full_text[start:end]
        
        # Find chapter title (text above "Question 1:" in the broader context)
        # Look backwards from start to find the title
        pre_text = full_text[max(0, start - 500):start].strip()
        lines = pre_text.split('\n')
        # Title is usually the last non-empty line(s) before Question 1
        title_lines = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                if title_lines:
                    break
                continue
            # Skip page numbers and noise
            if re.match(r'^\d+$', line):
                continue
            if 'MARROW' in line or 'Comprehensive' in line or 'Question Bank' in line:
                continue
            title_lines.insert(0, line)
            if len(title_lines) >= 3:
                break
        
        chapter_title = ' '.join(title_lines).strip()
        if not chapter_title:
            chapter_title = f"Chapter {ci + 1}"
        
        result.append({
            'title': chapter_title,
            'text': chunk
        })
    
    return result


def parse_answer_key(text):
    """Parse the 'Answer Key' table to get correct answers."""
    answers = {}
    
    # Find the Answer Key section
    ak_match = re.search(r'Answer Key\s*\n(.*?)(?=Solution|$)', text, re.DOTALL | re.IGNORECASE)
    if not ak_match:
        return answers
    
    ak_text = ak_match.group(1)
    
    # Parse rows: "Question No. Correct Option" header, then "1 d", "2 c", etc.
    # Also handle: "1. d", "1 - d", "1    d"
    pattern = re.compile(r'(\d+)\s*[.\-)]?\s*([a-dA-D])\b')
    for m in pattern.finditer(ak_text):
        q_num = int(m.group(1))
        correct = m.group(2).lower()
        answers[q_num] = 'abcd'.index(correct)
    
    return answers


def parse_solutions(text):
    """Parse 'Solution to Question N:' blocks."""
    solutions = {}
    
    # Split by "Solution to Question N:"
    pattern = re.compile(r'Solution to Question\s+(\d+)\s*:', re.IGNORECASE)
    matches = list(pattern.finditer(text))
    
    for i, m in enumerate(matches):
        q_num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        
        solution_text = text[start:end].strip()
        # Clean up
        solution_text = re.sub(r'\s+', ' ', solution_text)
        solution_text = solution_text.strip()
        
        # Limit length (some solutions are very long)
        if len(solution_text) > 1000:
            # Try to find a good truncation point
            truncated = solution_text[:1000]
            last_period = truncated.rfind('.')
            if last_period > 500:
                solution_text = truncated[:last_period + 1]
            else:
                solution_text = truncated + '...'
        
        solutions[q_num] = solution_text
    
    return solutions


def parse_questions(section_text):
    """Parse individual questions from a section."""
    questions = []
    
    # Find all "Question N:" markers
    q_pattern = re.compile(r'Question\s+(\d+)\s*[:.]', re.IGNORECASE)
    q_matches = list(q_pattern.finditer(section_text))
    
    # Find where Answer Key starts
    ak_pos = len(section_text)
    ak_match = re.search(r'Answer Key', section_text, re.IGNORECASE)
    if ak_match:
        ak_pos = ak_match.start()
    
    for qi, qm in enumerate(q_matches):
        q_num = int(qm.group(1))
        q_start = qm.end()
        
        # End is either next question or answer key
        if qi + 1 < len(q_matches):
            q_end = q_matches[qi + 1].start()
        else:
            q_end = ak_pos
        
        q_text = section_text[q_start:q_end].strip()
        
        # Parse options a) b) c) d)
        opt_pattern = re.compile(
            r'(?:^|\n)\s*([a-dA-D])\s*[).\]]\s*(.*?)(?=(?:\n\s*[a-dA-D]\s*[).\]])|$)',
            re.DOTALL
        )
        opt_matches = list(opt_pattern.finditer(q_text))
        
        if len(opt_matches) < 2:
            # Try alternative pattern
            opt_pattern2 = re.compile(
                r'([a-dA-D])\s*[).\]]\s*(.+?)(?=\s*[a-dA-D]\s*[).\]]|$)',
                re.DOTALL
            )
            opt_matches = list(opt_pattern2.finditer(q_text))
        
        options = []
        option_start_pos = len(q_text)
        
        for om in opt_matches:
            opt_label = om.group(1).lower()
            opt_text = om.group(2).strip()
            # Clean up multi-line options
            opt_text = re.sub(r'\s+', ' ', opt_text).strip()
            # Remove trailing noise
            opt_text = re.sub(r'\s*[,;.]*\s*$', '', opt_text).strip()
            options.append(opt_text)
            if om.start() < option_start_pos:
                option_start_pos = om.start()
        
        # Question text is everything before the first option
        question_text = q_text[:option_start_pos].strip()
        question_text = re.sub(r'\s+', ' ', question_text).strip()
        
        # Limit to 4 options
        options = options[:4]
        
        if question_text and len(options) >= 2:
            questions.append({
                'num': q_num,
                'question': question_text,
                'options': options
            })
    
    return questions


def process_section(section):
    """Process a single chapter section."""
    text = section['text']
    title = section['title']
    
    # Parse questions
    questions = parse_questions(text)
    
    # Parse answer key
    answer_key = parse_answer_key(text)
    
    # Parse solutions
    solutions = parse_solutions(text)
    
    # Merge data
    result = []
    for q in questions:
        q_num = q['num']
        correct_idx = answer_key.get(q_num, None)
        explanation = solutions.get(q_num, '')
        
        entry = {
            'question': q['question'],
            'options': q['options'],
            'correctIndex': correct_idx if correct_idx is not None else 0,
            'explanation': explanation
        }
        
        # Only include questions with at least 3 options and a valid answer
        if len(q['options']) >= 3:
            result.append(entry)
    
    return {
        'title': title,
        'questions': result
    }


# ============================================
# MAIN
# ============================================
def main():
    print("=" * 60)
    print("YourQuiz — PDF Question Extractor (OCR)")
    print("=" * 60)
    
    all_subjects = {}
    global_id = 1
    
    for subject_key, pdf_file in PDF_FILES.items():
        if not os.path.exists(pdf_file):
            print(f"\n⚠️  Skipping {subject_key}: {pdf_file} not found")
            continue
        
        print(f"\n📚 Processing: {SUBJECT_META[subject_key]['name']} ({pdf_file})")
        print(f"   File size: {os.path.getsize(pdf_file) / 1024 / 1024:.1f} MB")
        
        # Step 1: OCR all pages
        print("   Step 1: OCR extraction...")
        pages_text = extract_text_from_pdf(pdf_file)
        
        # Save raw OCR text for debugging
        raw_path = f"raw_ocr_{subject_key}.txt"
        with open(raw_path, 'w', encoding='utf-8') as f:
            for i, t in enumerate(pages_text):
                f.write(f"\n{'='*40} PAGE {i+1} {'='*40}\n")
                f.write(t)
        print(f"   Raw OCR text saved to: {raw_path}")
        
        # Step 2: Find chapter sections
        print("   Step 2: Parsing chapters...")
        sections = find_sections(pages_text)
        print(f"   Found {len(sections)} chapters")
        
        # Step 3: Parse questions from each section
        print("   Step 3: Extracting questions...")
        chapters = {}
        for si, section in enumerate(sections):
            parsed = process_section(section)
            
            # Generate a clean chapter key
            ch_key = re.sub(r'[^a-z0-9]+', '_', parsed['title'].lower()).strip('_')
            if not ch_key:
                ch_key = f"chapter_{si+1}"
            
            # Assign global IDs
            for q in parsed['questions']:
                q['id'] = global_id
                global_id += 1
            
            chapters[ch_key] = {
                'name': parsed['title'],
                'questions': parsed['questions']
            }
            
            q_count = len(parsed['questions'])
            with_explanations = sum(1 for q in parsed['questions'] if q.get('explanation'))
            print(f"   Chapter: {parsed['title'][:50]}... → {q_count} questions ({with_explanations} with explanations)")
        
        total_q = sum(len(ch['questions']) for ch in chapters.values())
        all_subjects[subject_key] = {
            'name': SUBJECT_META[subject_key]['name'],
            'icon': SUBJECT_META[subject_key]['icon'],
            'chapters': chapters
        }
        
        print(f"   ✅ Total: {total_q} questions extracted")
    
    # ============================================
    # Generate JavaScript output
    # ============================================
    print(f"\n📝 Generating questions.js...")
    
    js_content = """/**
 * YourQuiz — Question Bank (Auto-extracted from PDFs via OCR)
 * Generated by extract_questions.py
 * 
 * Structure: Each subject has chapters, each chapter has questions.
 * Question format:
 * {
 *   id: unique number,
 *   question: "Question text",
 *   options: ["Option A", "Option B", "Option C", "Option D"],
 *   correctIndex: 0-3 (index of correct option),
 *   explanation: "Explanation text"
 * }
 */

const QUESTION_BANK = """ + json.dumps(all_subjects, indent=2, ensure_ascii=False) + """;

// Utility: Get all questions for a subject
function getSubjectQuestions(subjectKey) {
    const subject = QUESTION_BANK[subjectKey];
    if (!subject) return [];
    const allQuestions = [];
    for (const chapterKey of Object.keys(subject.chapters)) {
        allQuestions.push(...subject.chapters[chapterKey].questions);
    }
    return allQuestions;
}

// Utility: Get chapter list for a subject
function getChapterList(subjectKey) {
    const subject = QUESTION_BANK[subjectKey];
    if (!subject) return [];
    return Object.entries(subject.chapters).map(([key, ch]) => ({
        key,
        name: ch.name,
        count: ch.questions.length
    }));
}

// Utility: Shuffle array (Fisher-Yates)
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
"""
    
    output_path = 'questions.js'
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
    
    file_size = os.path.getsize(output_path) / 1024
    total_all = sum(
        sum(len(ch['questions']) for ch in subj['chapters'].values())
        for subj in all_subjects.values()
    )
    
    print(f"\n{'='*60}")
    print(f"✅ DONE!")
    print(f"   Output: {output_path} ({file_size:.1f} KB)")
    print(f"   Total questions: {total_all}")
    print(f"   Subjects: {', '.join(s['name'] for s in all_subjects.values())}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
