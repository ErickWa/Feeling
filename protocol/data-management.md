# Data management

Short version of the rules in the Groundwork Methods Guide. Applies from the first signed form.

## Where things live

| What | Where | Never |
| --- | --- | --- |
| Templates, protocols, form versions, website | This repo | Participant data |
| Contact log, signed forms, recordings, transcripts, summary sheets | Encrypted vault | GitHub, email, unencrypted cloud |
| ID-to-name key | Second vault, separate password | The main vault |

## Vault layout (created by `scripts/make_vault.sh`)

```
FeelingTheMachine/
  01_panel/            contact log, signed Form 1s
  02_oral_history/     one folder per interview (OH001, OH002 ...)
  04_wave0/            empty until ethics approval
  05_journal/
  06_corpus/
  07_admin/            consent register, decision log, withdrawal log, correspondence
```

The key lives in a separate vault: `03_key/key.csv` with columns `id,name`.

## Rules

- **IDs:** P001 for panel members, OH001 for oral histories, W0-001 for the formal study. Names appear only in the contact log and the key.
- **File names:** `OH003_2027-03-14_transcript_final_EN.docx` (ID, date, content, version, language).
- **Backups:** three copies, on two kinds of media, one of them off-site. Test a restore every quarter (there's a recurring issue for it).
- **Retention:** contact details are deleted 12 months after someone leaves the panel. Oral history material is kept as the release says.
- **Withdrawals:** act within 14 days, log the date and action in `07_admin/withdrawal-log.csv`, and confirm in writing.
- **Cross-border:** log every move of material out of China, with the date, the files and the consent reference. Interviews in China avoid sensitive personal information.
- **Recordings:** copy them into the vault the same day, then delete them from the recorder or phone.
- **Panel emails:** mail to any feelingthemachine.com address is forwarded to the researcher's inbox. Once a person's details are in the vault and that has been checked, delete their emails from the mailbox. The privacy policy promises this.
- **Consent records** (the consent register, and on the site each consent row) are kept as long as any material they cover, because they are the proof of consent. Contact details still go at 12 months.
