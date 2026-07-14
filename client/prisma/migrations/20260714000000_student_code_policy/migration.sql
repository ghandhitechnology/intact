ALTER TABLE "User"
  ADD CONSTRAINT "User_student_login_id_format_check"
  CHECK (
    "role" <> 'USER'
    OR "loginId" ~ '^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$'
  );

ALTER TABLE "StudentIdentity"
  ADD CONSTRAINT "StudentIdentity_student_code_format_check"
  CHECK ("studentCode" ~ '^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$');

ALTER TABLE "StudentInvite"
  ADD CONSTRAINT "StudentInvite_student_code_format_check"
  CHECK ("studentCode" ~ '^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$');

ALTER TABLE "VerificationTicket"
  ADD CONSTRAINT "VerificationTicket_student_code_format_check"
  CHECK ("studentCode" ~ '^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$');
