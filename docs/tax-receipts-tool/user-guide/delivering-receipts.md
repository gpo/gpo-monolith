---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# Delivering receipts

[Back to the guide](README.md)

After receipts are [issued](issuing-receipts.md), they go to donors by
email or by post, according to each donor's preference. Delivery happens in
the **Deliver** step of a space's issuance wizard. Delivering needs the
same authority as issuing: the party CFO or a CFO designate.

## Donor pre-check

Before issuing, you can ask every donor in a space to confirm their mailing
address and whether they want their receipt by email or by post. This cuts
returned mail and wrong addresses.

1. In the issuance wizard's **Review** step, open the **Donor pre-check**
   card.
2. Enter the email **subject** and **message**. The donor's personal
   confirmation link is added below your message.
3. Give a reason and choose **Send pre-checks**.

The card reports how many were sent and how many were skipped. Donors with
no email address are skipped. Sending again sends a fresh link and cancels
the old one.

The donor clicks the link and sees a short public page (no sign-in) where
they confirm or correct their address and pick email or mail. Each link
works once and expires. A confirmed address is used for that donor's
receipt; it does not overwrite the contact record in Qomon.

Sending pre-checks needs *Edit contribution details*, and does not require
the space to be clear of work items, so it can go out well ahead of
issuance.

## The Deliver step

The Deliver step shows the space's delivery status in two halves.

### Email

| Count | Means |
|---|---|
| Ready to send | Issued receipts for email-preference donors, not yet sent |
| Sending | Queued and going out |
| Sent | Accepted by the email provider |
| Delivered | Confirmed delivered by the provider |

Write the **cover letter**, which goes in the body of each email (and on a
page in front of each printed receipt), after the donor's name and receipt
number. Check the **subject**, give a reason, and choose **Send emails** (the button shows how many).
Each email carries the receipt PDF.

Sending happens in the background at a steady rate, so a large space takes
a few minutes. You can leave the page; come back to see the counts move.

A donor with email preference but no email address is moved to mail
automatically.

### Mail

| Count | Means |
|---|---|
| Ready to print | Issued receipts for mail-preference donors, not yet in a batch |
| Printed, not mailed | In a print batch that has not been marked mailed |
| Mailed | In a batch marked mailed |

1. Choose **Create print batch**. The tool makes one PDF: for each receipt,
   a window-envelope letter with the cover letter, then the receipt. Pages
   are in receipt-number order.
2. **Download** the batch and print it.
3. After posting, choose **Mark mailed** and enter the **date mailed**. The
   receipts count as delivered from that date.

When every issued receipt in the space has been sent or mailed, the space
moves to the *delivered* stage on the dashboard.

## When an email bounces

If a receipt email bounces permanently, is suppressed, or finally fails to
send:

- the receipt, and that donor's preference for the year, switch to **mail**
  straight away, so the receipt cannot be forgotten;
- a **Delivery** item opens in the [work queue](work-queue.md) asking
  someone to check the donor's address;
- the receipt appears among the bounced receipts in the Deliver step and
  goes into the next print batch.

The Delivery item closes on its own when that print batch is marked
mailed. A spam complaint changes nothing, since the email did arrive.

## Real email versus simulated email

Outside production, and in production until a system administrator turns
it on, **no real email leaves the system**. Every send is simulated: it is
logged and the receipt is marked delivered exactly as if it had gone, so
the whole process can be rehearsed safely.

Real sending needs all three of:

1. the environment to allow it (set only in production);
2. a system administrator to turn on **Send real email** under
   [Admin > Emails](administration.md#emails);
3. a real email provider to be configured.

Admin > Emails also holds the **email log**: every email the tool has sent
or simulated, searchable by address, donor, or receipt number, with its
body and the provider's delivery events. It is limited to system
administrators because emails carry donor details and live confirmation
links.

While the [kill switch](administration.md#kill-switch) is engaged, receipt
emails and print batches are held. Pre-check emails still go out, since
they issue nothing.
