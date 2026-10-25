// ── TERMS OF USE & ADMINISTRATOR AGREEMENT ────────────────────────────────────
// The text every user must accept before using the app (see TermsService.gs). Edit it for each club and
// have it reviewed by the club's committee or lawyer: this is a starting template, not legal advice.
//
// To change a document: edit its text, raise its `version` and set `updated`. Everyone it applies to is
// asked to accept the new version at their next sign-in. Earlier acceptances stay on record.
//   use:   Terms of Use               -- every user (members and administrators)
//   admin: Administrator Agreement    -- users with the Admin role, in addition to the Terms of Use
// A function, not a constant, so SACCO_NAME (Config.gs) is read when it is called.

function _termsDocuments() {
  const club = SACCO_NAME;
  return {
    use: {
      title: 'Terms of Use', version: '1', updated: '2026-10-25',
      appliesTo: 'Everyone who uses the system',
      intro: 'These terms apply to everyone who uses the ' + club + ' system ("the system"). By ticking the box you confirm that you have read them and agree to follow them.',
      sections: [
        { heading: 'Your account', points: [
          'Your account is personal. Do not share it, and do not let anyone else sign in as you.',
          'Keep your sign-in codes and your email account secure. Never give a sign-in code to anyone, including someone who says they are from the club.',
          'Sign out after using a shared or public device, and tell the committee at once if you think someone else has used your account.'] },
        { heading: 'Accurate information', points: [
          'Information you give the club through the system (contact details, loan and withdrawal requests, guarantor responses) must be true and complete.',
          'If you see a mistake in your savings, loans or other records, report it to the treasurer or the committee. Do not try to correct it yourself.'] },
        { heading: 'Confidentiality', points: [
          'Information about other members that you see through the system, such as names, guarantor requests and amounts, is confidential.',
          'Use it only for club business and do not share it outside the club.'] },
        { heading: 'Proper use; no manipulation', points: [
          'Use the system only for its intended purpose.',
          'Do not try to view other members\' records, change any record, get around approval steps, or use automated tools or scripts against the system.',
          'If you find an error or weakness in the system, report it to the committee and do not use it.'] },
        { heading: 'Records and decisions', points: [
          'Transactions recorded by the club\'s administrators in the system are the club\'s official record, subject to correction through the club\'s procedures.',
          'Loans, withdrawals and other requests are decided under the club\'s constitution and by-laws. Disagreements are raised with the committee.',
          'When you agree to be a guarantor, you accept the obligations of a guarantor under the by-laws.'] },
        { heading: 'Your personal data', points: [
          'The club keeps your name, contact details, membership details, savings, loans and related records in order to run the club, and uses your email to send you codes, notices and statements.',
          'Your data is handled in line with applicable data protection law (in Uganda, the Data Protection and Privacy Act, 2019). You may ask the committee to see or correct your data.'] },
        { heading: 'Breaches and changes', points: [
          'Breaking these terms may lead to your access being suspended and to action under the club\'s by-laws.',
          'Every action in the system is recorded with the user\'s name and the time.',
          'The club may change these terms. You will be asked to accept the new version before you continue using the system.'] }
      ],
      checkbox: 'I have read and agree to the Terms of Use.'
    },
    admin: {
      title: 'Administrator Confidentiality and Conduct Agreement', version: '1', updated: '2026-10-25',
      appliesTo: 'Administrators (in addition to the Terms of Use)',
      intro: 'As an administrator of the ' + club + ' system you can see and record every member\'s personal and financial information. This agreement sets out the duties that come with that access. It applies for as long as you are an administrator, and the confidentiality duties continue after your role ends.',
      sections: [
        { heading: 'Confidentiality and non-disclosure', points: [
          'All member information, financial records, reports and exports you access as an administrator are confidential.',
          'Use them only to carry out your duties for the club. Do not disclose them to anyone outside the club\'s administration, unless the committee authorises it or the law requires it.',
          'Do not copy, photograph or forward member information for any other purpose.'] },
        { heading: 'Exports and documents', points: [
          'Keep downloaded reports (PDF, Excel, CSV) on secure devices, share them only with people entitled to them, and delete them when they are no longer needed.',
          'Do not upload club data to services that are not approved by the club.'] },
        { heading: 'Integrity of records; no manipulation', points: [
          'Record only genuine transactions, with their true amounts and dates.',
          'Never alter, delete, backdate or fabricate records. Never edit the club\'s spreadsheet directly.',
          'Correct mistakes only through the system (reversals and corrections with a reason), so the audit trail stays complete.'] },
        { heading: 'Segregation of duties', points: [
          'Do not approve a request that you started, or that benefits you.',
          'Do not arrange with another administrator to get around the two-administrator approval rules, and never use another administrator\'s account.'] },
        { heading: 'Conflicts of interest', points: [
          'Declare any personal interest in a decision (for example, a relative\'s loan) and leave that decision to other administrators.'] },
        { heading: 'Security', points: [
          'Protect your account (use 2-step verification on your email).',
          'Report any suspected misuse, data leak or security problem to the committee immediately.'] },
        { heading: 'Monitoring and breaches', points: [
          'Every administrator action is recorded with your name and the time, and may be reviewed by the committee or an auditor.',
          'A breach of this agreement may lead to removal of your administrator rights, action under the club\'s by-laws, and legal action where the law allows.'] }
      ],
      checkbox: 'I have read and agree to the Administrator Confidentiality and Conduct Agreement.'
    }
  };
}
