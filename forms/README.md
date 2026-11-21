# Forms

Released versions of the participant forms. The drafts live in the Consent and Release Forms doc:
https://claude.ai/artifact/WSJRn9X7Jt5RJUFxh1VfnF

## Releasing a version

1. When the wording is final, including a native Chinese reviewer's review of the Chinese and a native speaker's German review, export each form from the doc as a PDF.
2. Save the PDFs under `forms/v1.0/`, using these names:
   - `F1_panel-agreement_EN.pdf` / `F1_panel-agreement_ZH.pdf` / `F1_panel-agreement_DE.pdf`
   - `F2_oral-history-information_EN.pdf` / `..._ZH.pdf` / `..._DE.pdf`
   - `F3_oral-history-release_EN.pdf` / `..._ZH.pdf` / `..._DE.pdf`
   - `F4_change-or-withdrawal_EN.pdf` / `..._ZH.pdf` / `..._DE.pdf`

   Interviews can be in English, Chinese or German (decided 2026-11-21).
   Form 3's grant of rights wants a German lawyer's look before a German
   copy is signed (note under it in the doc).
3. Add a line to `CHANGELOG.md` and commit.
4. Never edit a released version. Make a new version folder instead.

Only **blank** forms go here. Signed copies go in the vault, and the version each person signed goes in the consent register.
