from professor_core.persona import build_system_prompt
from professor_core.protocol import EMOTIONS, PersonaConfig


def test_uses_the_teacher_name_and_explains_the_markup() -> None:
    prompt = build_system_prompt(PersonaConfig(name="Chalk"))
    assert prompt.startswith("You are Chalk,")
    for emotion in EMOTIONS:
        assert f"[{emotion}]" in prompt
    assert "<en>" in prompt


def test_adds_the_student_instructions_at_the_end() -> None:
    prompt = build_system_prompt(
        PersonaConfig(name="Chalk", instructions="  Use cooking examples. ")
    )
    assert prompt.endswith("Use cooking examples.\n")


def test_leaves_out_empty_instructions() -> None:
    assert "added these instructions" not in build_system_prompt(PersonaConfig(name="Chalk"))
