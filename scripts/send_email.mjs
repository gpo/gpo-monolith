import 'dotenv/config'
import sendgrid from "@sendgrid/mail"

sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

function sendEmail(from, to, subject, body) {
  sendgrid
    .send({ from, to, subject, html: body })
    .then(() => {
      console.log(`Email sent from ${from} to ${to}`);
    })
    .catch((error) => {
      console.error(error);
    });
}
sendNominationEmail('Mike', 'Schreiner', 'mikeschreiner@gpo.ca')
function sendNominationEmail (first_name, last_name, email, ) {
    sendEmail(
        "GPO Nominations Committee <nominations@gpo.ca>",
        `${first_name} ${last_name} <${email}>`,
        "GPO Candidate Application 2024",
        `
        <html><body>
        <p>Hi ${first_name},</p>

    <p>Thank you for your interest in becoming a GPO Candidate in the upcoming election.</p>

    <p>You should have received an email with a login to secure.gpo.ca. Once you've signed in to secure.gpo.ca you can access the Candidate Application here:
    <a href="https://secure.gpo.ca/form/candidate-application-2024">https://secure.gpo.ca/form/candidate-application-2024</a>
    </p>

    <p>Kind Regards,<br>GPO Nomination Team</p>
    </body></html>
    `
    );
}

