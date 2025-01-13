-- Set max exec time
SET max_statement_time = 0;

use gpo_secure_crm;

WITH
    -- Filter contributions (completed, non-G&S, Agency Contribution, Event Fee, Member Dues, Other Non-deductible, or Party Contribution)
    -- NOTE: this allow us to fix the receive date and do calculations on monthlies/non-monthlies
    contribFiltered AS (
        SELECT
            contribAll.`id`,
            contribAll.`contact_id`,
            CASE WHEN reporting.`eo_date_50` > 0 THEN reporting.`eo_date_50` ELSE contribAll.`receive_date` END as 'receive_date',
                CASE WHEN reporting.`eo_date_50` > 0 THEN YEAR(reporting.`eo_date_50`) ELSE YEAR(contribAll.`receive_date`) END as 'year',
			contribAll.`total_amount`,
			payment.name as 'payment_instrument',
			CASE WHEN (source = 'MTH' OR source LIKE '%(MTH)%') THEN 1 ELSE 0 END as 'is_monthly',
			CASE WHEN (source = 'MTH' OR source LIKE '%(MTH)%') THEN '1_' ELSE '9_' END as 'earliest_monthly_concat',
			CASE WHEN (source = 'MTH' OR source LIKE '%(MTH)%') THEN '1_' ELSE '0_' END as 'latest_monthly_concat'

		FROM `civicrm_contribution` as contribAll
			LEFT JOIN `civicrm_value_reporting_4` as reporting ON reporting.`entity_id` = contribAll.`id`
			LEFT JOIN `civicrm_option_value` as payment ON payment.`value` = contribAll.`payment_instrument_id` AND payment.`option_group_id` = 10

		WHERE
			contribAll.`financial_type_id` IN (14, 4, 2, 6, 1)
			AND contribAll.`contribution_status_id` = 1
			AND IF(reporting.`goods__services_47`, 1, 0) = 0 -- required to properly check against NULL
			AND IF(contribAll.`is_test`, 1, 0) = 0
	),

	-- Most recent, earliest, largest donations, yearly totals, monthlies
	-- NOTE: a LEFT JOIN on contribFiltered in the main query messes with COUNT and SUM
	contrib AS (
		SELECT
			`contact_id`,

			-- Total donations
			COUNT(id) as 'TotalDonations',

			-- Total monthlies
			MAX(is_monthly) as 'HasMonthlies',
			SUM(is_monthly) as 'TotalMonthlyDonations',
			COUNT(id)-SUM(is_monthly) as 'TotalNonMonthlyDonations',


			-- Total donations per year
			SUM(CASE WHEN (`year` = '2004') THEN `total_amount`END) as 'Donation_Totals_2004',
			SUM(CASE WHEN (`year` = '2005') THEN `total_amount`END) as 'Donation_Totals_2005',
			SUM(CASE WHEN (`year` = '2006') THEN `total_amount`END) as 'Donation_Totals_2006',
			SUM(CASE WHEN (`year` = '2007') THEN `total_amount`END) as 'Donation_Totals_2007',
			SUM(CASE WHEN (`year` = '2008') THEN `total_amount`END) as 'Donation_Totals_2008',
			SUM(CASE WHEN (`year` = '2009') THEN `total_amount`END) as 'Donation_Totals_2009',
			SUM(CASE WHEN (`year` = '2010') THEN `total_amount`END) as 'Donation_Totals_2010',
			SUM(CASE WHEN (`year` = '2011') THEN `total_amount`END) as 'Donation_Totals_2011',
			SUM(CASE WHEN (`year` = '2012') THEN `total_amount`END) as 'Donation_Totals_2012',
			SUM(CASE WHEN (`year` = '2013') THEN `total_amount`END) as 'Donation_Totals_2013',
			SUM(CASE WHEN (`year` = '2014') THEN `total_amount`END) as 'Donation_Totals_2014',
			SUM(CASE WHEN (`year` = '2015') THEN `total_amount`END) as 'Donation_Totals_2015',
			SUM(CASE WHEN (`year` = '2016') THEN `total_amount`END) as 'Donation_Totals_2016',
			SUM(CASE WHEN (`year` = '2017') THEN `total_amount`END) as 'Donation_Totals_2017',
			SUM(CASE WHEN (`year` = '2018') THEN `total_amount`END) as 'Donation_Totals_2018',
			SUM(CASE WHEN (`year` = '2019') THEN `total_amount`END) as 'Donation_Totals_2019',
			SUM(CASE WHEN (`year` = '2020') THEN `total_amount`END) as 'Donation_Totals_2020',
			SUM(CASE WHEN (`year` = '2021') THEN `total_amount`END) as 'Donation_Totals_2021',
			SUM(CASE WHEN (`year` = '2022') THEN `total_amount`END) as 'Donation_Totals_2022',
			SUM(CASE WHEN (`year` = '2023') THEN `total_amount`END) as 'Donation_Totals_2023',
            SUM(CASE WHEN (`year` = '2024') THEN `total_amount`END) as 'Donation_Totals_2024',

			SUM(CASE WHEN (`year` = '2004') THEN 1 END) as 'Donation_Frequency_2004',
			SUM(CASE WHEN (`year` = '2005') THEN 1 END) as 'Donation_Frequency_2005',
			SUM(CASE WHEN (`year` = '2006') THEN 1 END) as 'Donation_Frequency_2006',
			SUM(CASE WHEN (`year` = '2007') THEN 1 END) as 'Donation_Frequency_2007',
			SUM(CASE WHEN (`year` = '2008') THEN 1 END) as 'Donation_Frequency_2008',
			SUM(CASE WHEN (`year` = '2009') THEN 1 END) as 'Donation_Frequency_2009',
			SUM(CASE WHEN (`year` = '2010') THEN 1 END) as 'Donation_Frequency_2010',
			SUM(CASE WHEN (`year` = '2011') THEN 1 END) as 'Donation_Frequency_2011',
			SUM(CASE WHEN (`year` = '2012') THEN 1 END) as 'Donation_Frequency_2012',
			SUM(CASE WHEN (`year` = '2013') THEN 1 END) as 'Donation_Frequency_2013',
			SUM(CASE WHEN (`year` = '2014') THEN 1 END) as 'Donation_Frequency_2014',
			SUM(CASE WHEN (`year` = '2015') THEN 1 END) as 'Donation_Frequency_2015',
			SUM(CASE WHEN (`year` = '2016') THEN 1 END) as 'Donation_Frequency_2016',
			SUM(CASE WHEN (`year` = '2017') THEN 1 END) as 'Donation_Frequency_2017',
			SUM(CASE WHEN (`year` = '2018') THEN 1 END) as 'Donation_Frequency_2018',
			SUM(CASE WHEN (`year` = '2019') THEN 1 END) as 'Donation_Frequency_2019',
			SUM(CASE WHEN (`year` = '2020') THEN 1 END) as 'Donation_Frequency_2020',
			SUM(CASE WHEN (`year` = '2021') THEN 1 END) as 'Donation_Frequency_2021',
			SUM(CASE WHEN (`year` = '2022') THEN 1 END) as 'Donation_Frequency_2022',
			SUM(CASE WHEN (`year` = '2023') THEN 1 END) as 'Donation_Frequency_2023',
            SUM(CASE WHEN (`year` = '2024') THEN 1 END) as 'Donation_Frequency_2024',

			-- Earliest donation
			MIN(`receive_date`) as 'EarliestDonationDate',
			SUBSTRING(MIN(CONCAT(receive_date, "_", `total_amount`)), 21) AS 'EarliestDonationAmount',

			-- Most recent donation
			MAX(`receive_date`) as 'LastDonationDate',
			SUBSTRING(MAX(CONCAT(receive_date, "_", `total_amount`)), 21) AS 'LastDonationAmount',
			SUBSTRING(MAX(CONCAT(receive_date, "_", `payment_instrument`)), 21) AS 'LastDonationPayment',

			-- Largest donation
			MAX(`total_amount`) as 'LargestDonationAmount',
			SUBSTRING(MAX(CONCAT(LPAD(total_amount, 10, '0'), "_", `receive_date`)), 12) AS 'LargestDonationDate',

			-- Earliest monthly donation
			IF( MAX(`is_monthly`) = 1, SUBSTRING(MIN(CONCAT(earliest_monthly_concat, receive_date)), 3), NULL) AS 'EarliestMonthlyDonationDate',
			IF( MAX(`is_monthly`) = 1, SUBSTRING(MIN(CONCAT(earliest_monthly_concat, receive_date, "_", `total_amount`)), 23), NULL) AS 'EarliestMonthlyDonationAmount',

			-- Most recent monthly donation
			IF( MAX(`is_monthly`) = 1, SUBSTRING(MAX(CONCAT(latest_monthly_concat, receive_date)), 3), NULL) AS 'LatestMonthlyDonationDate',
			IF( MAX(`is_monthly`) = 1, SUBSTRING(MAX(CONCAT(latest_monthly_concat, receive_date, "_", `total_amount`)), 23), NULL) AS 'LatestMonthlyDonationAmount',


			1
		FROM contribFiltered
		GROUP BY `contact_id`
		ORDER BY `contact_id`
	),

	-- Membership info
	-- NOTE: a LEFT JOIN directly in the main SQL would severely impact performance, so we did a CTE instead
	member AS (
		SELECT
			member.`contact_id`,
			memberStatus.`label` as 'status',
			member.`join_date`,
			member.`start_date`,
			member.`end_date`

		FROM `civicrm_membership` as member
				LEFT JOIN `civicrm_membership_status` as memberStatus ON memberStatus.`id` = member.`status_id`

		GROUP BY member.`contact_id`
	),

	-- Phone calls, Direct mails and petitions
	-- NOTE: a LEFT JOIN directly in the main SQL would severely impact performance, so we did a CTE instead
	activities AS (
		SELECT
			activityLink.`contact_id`,

			-- Phone
			SUM(CASE WHEN activity.`activity_type_id` = 72 THEN 1 ELSE 0 END) as 'phonecalls_total',
			MIN(CASE WHEN activity.`activity_type_id` = 72 THEN activity.`activity_date_time` ELSE NULL END) as 'phonecalls_earliest',
			MAX(CASE WHEN activity.`activity_type_id` = 72 THEN activity.`activity_date_time` ELSE NULL END) as 'phonecalls_latest',

			-- Mail
			SUM(CASE WHEN activity.`activity_type_id` = 73 THEN 1 ELSE 0 END) as 'mailings_total',
			MIN(CASE WHEN activity.`activity_type_id` = 73 THEN activity.`activity_date_time` ELSE NULL END) as 'mailings_earliest',
			MAX(CASE WHEN activity.`activity_type_id` = 73 THEN activity.`activity_date_time` ELSE NULL END) as 'mailings_latest'

		FROM `civicrm_activity` as activity
			LEFT JOIN `civicrm_activity_contact` as activityLink ON activityLink.`activity_id` = activity.`id`
		WHERE
			activity.`activity_type_id` IN (72,73)
			AND activityLink.`record_type_id` = 3
		GROUP BY activityLink.`contact_id`
	),

	-- Dedupe Call to actions (petitions)
	-- NOTE: a LEFT JOIN directly in the main SQL would severely impact performance, so we did a CTE instead
	ctasDeduped AS (
		SELECT
			activity.`id`,
			activityLink.`contact_id`,
			activity.`activity_type_id`,
			activity.`activity_date_time`,
			activity.`subject`

		FROM `civicrm_activity` as activity
			INNER JOIN `civicrm_activity_contact` as activityLink ON activityLink.`activity_id` = activity.`id` AND activityLink.`record_type_id` = 3
		WHERE
			activity.`activity_type_id` = 44
		GROUP BY activityLink.`contact_id`, activity.`subject`
		ORDER BY activity.`activity_date_time` DESC
	),

	-- Call to actions (petitions)
	-- NOTE: a LEFT JOIN on ctasDeduped in the main query messes with COUNT
	ctas AS (

		SELECT
			ctasDeduped.`contact_id`,
			COUNT(ctasDeduped.`id`) as 'petitions_total',
			MIN(ctasDeduped.`activity_date_time`) as 'petitions_earliest',
			MAX(ctasDeduped.`activity_date_time`) as 'petitions_latest',
			ctasDeduped.`subject` as 'petitions_latest_subject'
		FROM ctasDeduped
		GROUP BY ctasDeduped.`contact_id`
		ORDER BY `contact_id`

	),

	-- Event registrations
	-- NOTE: a LEFT JOIN in the main query messes with COUNT
	eventRegister AS (
		SELECT
			activity.`contact_id`,
			COUNT(activity.`id`) as 'events_total',
			MIN(activity.`register_date`) as 'events_earliest',
			MAX(activity.`register_date`) as 'events_latest'

		FROM `civicrm_participant` as activity
		GROUP BY activity.`contact_id`
	)



-- Main Query
-- NOTE: a CTE for basic contact info would severely impact performance, so we did simple LEFT JOINS instead

SELECT
    contact.`id` as 'Internal Contact ID',
        contact.`created_date` as 'Created Date',
        contact.`is_deceased` as 'Deceased',

	-- Name
        contact.`first_name` as 'First Name',
        contact.`middle_name` as 'Middle Name',
        contact.`last_name` as 'Last Name',
        contact.`nick_name` as 'Nick Name',
        personalization.`greeting_54` as 'Greetings',

	-- Address
        address.`street_address` as 'Street Address',
        address.`supplemental_address_1` as 'Additional Address 1',
        address.`city` as 'City',
        state.`abbreviation` as 'State',
        address.`postal_code` as 'Postal Code',
        location.`display_name` as 'Location Type',

	-- Phone, Email, Website
        phone.`phone` as 'Phone',
        phone.`phone_ext` as 'Bad Phone Record',
        email.`email` as 'Email',
        website.`url` as 'Website',

	-- Contribute Link
        CONCAT('https://secure.gpo.ca/civicrm/contribute/transact?reset=1&id=30&cs=', MD5(CONCAT(contact.`hash`, '_', contact.`id`, '_', UNIX_TIMESTAMP(), '_', '2160')), '_', UNIX_TIMESTAMP(), '_', '2160', '&cid=', contact.`id`) AS 'url',

	-- Communications Preferences
        contact.`do_not_email` as 'Do Not Email',
        contact.`do_not_phone` as 'Do Not Phone',
        contact.`do_not_mail` as 'Do Not Mail',
        contact.`do_not_trade` as 'Do Not Trade',
        contact.`is_opt_out` as 'No Bulk Emails (User Opt Out)',
        email.`on_hold` as 'On Hold',

	-- Riding
        riding2005.`label` as 'Riding Name (2005)',
        riding2016.`label` as 'Riding Name (2016)',
        contact.`source` as 'Source of Contact Data',
        riding.`region_34` as 'Region',

	-- Group, Tags
	-- GROUP_CONCAT(DISTINCT groupInfo.`title`) as 'Group',
        '' as 'Group',
        GROUP_CONCAT(DISTINCT tag.`name`) as 'Tag(s)',

	-- External IDs
        contactId.`gpc_id_77` as 'GPC ID',
        contactId.`elections_ontario_id_78` as 'Elections Ontario ID',

	-- Other contact info
        contact.`birth_date` as 'Birth Date',
        (CASE WHEN contact.`gender_id` = 1 THEN 'Female' WHEN contact.`gender_id` = 2 THEN 'Male' END) as 'Gender',

	-- Old address
        addressOld.`street_address` as 'Old Street Address',
        addressOld.`city` as 'Old City',
        stateOld.`abbreviation` as 'Old State',
        addressOld.`postal_code` as 'Old Postal Code',

	-- Contributions to GPC
        contribGPC.`gpc_2008_79` as 'GPC 2008',
        contribGPC.`gpc_2009_80` as 'GPC 2009',
        contribGPC.`gpc_2010_81` as 'GPC 2010',
        contribGPC.`gpc_2011_82` as 'GPC 2011',
        contribGPC.`gpc_2012_83` as 'GPC 2012',
        contribGPC.`gpc_2013_84` as 'GPC 2013',
        contribGPC.`gpc_2014_85` as 'GPC 2014',
        contribGPC.`gpc_2015_86` as 'GPC 2015',
        contribGPC.`gpc_2016_87` as 'GPC 2016',
        contribGPC.`gpc_2017_88` as 'GPC 2017',
        contribGPC.`gpc_2018_89` as 'GPC 2018',
        contribGPC.`gpc_2019_106` as 'GPC 2019',
        contribGPC.`gpc_2020_116` as 'GPC 2020',
        contribGPC.`gpc_2021_117` as 'GPC 2021',
        contribGPC.`gpc_2022_156` as 'GPC 2022',
        contribGPC.`gpc_2023_165` as 'GPC 2023',
        contribGPC.`gpc_2024_169` as 'GPC 2024',

	-- Total contributions per year
        contrib.`Donation_Totals_2004`,
    contrib.`Donation_Totals_2005`,
    contrib.`Donation_Totals_2006`,
    contrib.`Donation_Totals_2007`,
    contrib.`Donation_Totals_2008`,
    contrib.`Donation_Totals_2009`,
    contrib.`Donation_Totals_2010`,
    contrib.`Donation_Totals_2011`,
    contrib.`Donation_Totals_2012`,
    contrib.`Donation_Totals_2013`,
    contrib.`Donation_Totals_2014`,
    contrib.`Donation_Totals_2015`,
    contrib.`Donation_Totals_2016`,
    contrib.`Donation_Totals_2017`,
    contrib.`Donation_Totals_2018`,
    contrib.`Donation_Totals_2019`,
    contrib.`Donation_Totals_2020`,
    contrib.`Donation_Totals_2021`,
    contrib.`Donation_Totals_2022`,
    contrib.`Donation_Totals_2023`,
    contrib.`Donation_Totals_2024`,

    contrib.`Donation_Frequency_2004`,
    contrib.`Donation_Frequency_2005`,
    contrib.`Donation_Frequency_2006`,
    contrib.`Donation_Frequency_2007`,
    contrib.`Donation_Frequency_2008`,
    contrib.`Donation_Frequency_2009`,
    contrib.`Donation_Frequency_2010`,
    contrib.`Donation_Frequency_2011`,
    contrib.`Donation_Frequency_2012`,
    contrib.`Donation_Frequency_2013`,
    contrib.`Donation_Frequency_2014`,
    contrib.`Donation_Frequency_2015`,
    contrib.`Donation_Frequency_2016`,
    contrib.`Donation_Frequency_2017`,
    contrib.`Donation_Frequency_2018`,
    contrib.`Donation_Frequency_2019`,
    contrib.`Donation_Frequency_2020`,
    contrib.`Donation_Frequency_2021`,
    contrib.`Donation_Frequency_2022`,
    contrib.`Donation_Frequency_2023`,
    contrib.`Donation_Frequency_2024`,

    -- Most recent contribution
    contrib.`LastDonationDate` as 'Recent Donation Date',
        contrib.`LastDonationAmount` as 'Recent Donation Amount',
        contrib.`LastDonationPayment` as 'Payment Instrument',

	-- Total non monthlies
        contrib.`TotalNonMonthlyDonations` as 'Number Non Monthly Gifts',

	-- Earliest contribution
        contrib.`EarliestDonationDate` as 'Earliest Donation Date',
        contrib.`EarliestDonationAmount` as 'Earliest Donation Amount',

	-- Largest contribution
        contrib.`LargestDonationAmount` as 'Largest Donation Amount',
        contrib.`LargestDonationDate` as 'Largest Donation Date',

	-- Total monthlies
        contrib.`TotalMonthlyDonations` as 'Number Monthly Gifts',

	-- Earliest monthly donation
        contrib.`EarliestMonthlyDonationDate` as 'Earliest Monthly Date',
	-- contrib.`EarliestMonthlyDonationAmount` as 'Earliest Monthly Amount',

	-- Most recent monthly donation
        contrib.`LatestMonthlyDonationDate` as 'Latest Monthly Date',
        contrib.`LatestMonthlyDonationAmount` as 'Latest Monthly Amount',

	-- Involvement
        involvement.`volunteer_35` as 'Volunteer',
        involvement.`sign_37` as 'Lawn Sign',

	-- Membership
        member.`status` as 'Membership Status',
        member.`join_date` as 'Membership Join Date',
        member.`start_date` as 'Membership Start Date',
        member.`end_date` as 'Membership End Date',

	-- Phone calls
        activities.`phonecalls_total` as 'Number of Phone Calls',
        activities.`phonecalls_earliest` as 'Earliest Phone Call',
        activities.`phonecalls_latest` as 'Latest Phone Call',

	-- Events
        eventRegister.`events_total` as 'Number of Event Registration',
        eventRegister.`events_earliest` as 'Earliest Event Registration',
        eventRegister.`events_latest` as 'Latest Event Registration',

	-- Direct mails
        activities.`mailings_total` as 'Number of Direct Mail',
        activities.`mailings_earliest` as 'Earliest Direct Mail',
        activities.`mailings_latest` as 'Latest Direct Mail',

	-- Call to Actions
        ctas.`petitions_total` as 'Number of Call to Actions',
        ctas.`petitions_earliest` as 'Earliest Call to Action',
        ctas.`petitions_latest` as 'Latest Call to Action',
        ctas.`petitions_latest_subject` as 'Latest Call to Action Subject'

FROM `civicrm_contact` as contact

         -- Address
         LEFT JOIN `civicrm_address` as address ON address.`contact_id` = contact.`id` AND address.`is_primary` = 1
         LEFT JOIN `civicrm_state_province` as state ON state.`id` = address.`state_province_id`
         LEFT JOIN `civicrm_address` as addressOld ON addressOld.`contact_id` = contact.`id` AND addressOld.`location_type_id` = 6
         LEFT JOIN `civicrm_state_province` as stateOld ON stateOld.`id` = addressOld.`state_province_id`
         LEFT JOIN `civicrm_location_type` as location ON location.`id` = address.`location_type_id`

    -- Phone / Email
         LEFT JOIN `civicrm_phone` as phone ON phone.`contact_id` = contact.`id` AND phone.`is_primary` = 1
         LEFT JOIN `civicrm_email` as email ON email.`contact_id` = contact.`id` AND email.`is_primary` = 1

    -- Website
         LEFT JOIN `civicrm_website`as website ON website.`contact_id` = contact.`id` AND website.`website_type_id` = 1

    -- Greeting
         LEFT JOIN `civicrm_value_personalization_14` as personalization ON personalization.`entity_id` = contact.`id`

    -- Tag(s)
         LEFT JOIN `civicrm_entity_tag` as tagLink ON tagLink.`entity_id` = contact.`id`
         LEFT JOIN `civicrm_tag` as tag ON tag.`id` = tagLink.`tag_id`

    -- Group(s)
         LEFT JOIN `civicrm_group_contact` as groupLink ON groupLink.`contact_id` = contact.`id` AND groupLink.`status` = 'Added'
         LEFT JOIN `civicrm_group` as groupInfo ON groupInfo.`id` = groupLink.`group_id`

    -- Riding
         LEFT JOIN `civicrm_value_riding_info` as riding ON riding.`entity_id` = contact.`id`
         LEFT JOIN `civicrm_option_value` as riding2016 ON riding2016.`value` = riding.`riding_name_2016_65` AND riding2016.`option_group_id` = 475
         LEFT JOIN `civicrm_option_value` as riding2005 ON riding2005.`value` = riding.`riding_11` AND riding2005.`option_group_id` = 1043

    -- External IDs
         LEFT JOIN `civicrm_value_foreign_keys_18` as contactId ON contactId.`entity_id` = contact.`id`
         LEFT JOIN `civicrm_value_gpc_donations_19` as contribGPC ON contribGPC.`entity_id` = contact.`id`

    -- Contributions
         LEFT JOIN contrib ON contrib.`contact_id` = contact.`id`

    -- Involvement
         LEFT JOIN `civicrm_value_involvement_10` as involvement ON involvement.`entity_id` = contact.`id`

    -- Membership
         LEFT JOIN member ON member.`contact_id` = contact.`id`

    -- Activities
         LEFT JOIN activities ON activities.`contact_id` = contact.`id`
         LEFT JOIN ctas ON ctas.`contact_id` = contact.`id`
         LEFT JOIN eventRegister ON eventRegister.`contact_id` = contact.`id`

WHERE
    contact.`is_deleted` = 0

GROUP BY
    contact.`id`;