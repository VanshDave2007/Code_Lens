from app.analyzer import analyze_code

def test_valid_code_has_metrics():
    report = analyze_code('import os\n\ndef hello(name):\n    return name\n')
    assert report["ok"]
    assert report["metrics"]["functions"] == 1
    assert any(f["rule_id"] == "CL003" for f in report["findings"])

def test_syntax_error_is_safe():
    report = analyze_code('def hello()\n  pass')
    assert not report["ok"]
    assert report["syntax_error"]["line"] == 1
