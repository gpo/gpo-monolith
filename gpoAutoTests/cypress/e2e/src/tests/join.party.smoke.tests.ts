import {billingScreen} from '../pages/join.party.billing.screen'
import {thankYouPage} from '../pages/thank.you.page'
import {mainPage} from '../pages/main.page'
import { amountScreen } from '../pages/join.party.amount.screen'
import { personalInfoScreen } from '../pages/join.party.personal.info.screen'

import member from '../../../fixtures/member.json'
import consts from '../../../fixtures/consts.json'

describe('Join party (Become a Member), smoke tests', () => {

    beforeEach(() => {
        cy.fixture('member.json').as('member')
        cy.openMainPage();
        //mainPage.becomeMemberClick()
    })

    it('Standart membership, other amount=min amount, all fields filled', () => {
        amountScreen.chooseStandartMembership()
        amountScreen.enterOtherAmount(consts.min_additionlal_contribution.toString());
        billingScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        billingScreen.continue()
        billingScreen.fillCreditCard(member.one_year_card_number, member.security_code, member.expiration_year, member.expiration_month);
        billingScreen.uncheckBillingAddressTheSame()
        billingScreen.fillRequiredAddressFieldsWithoutCountryProvince(member.billing_first_name, member.billing_last_name, member.billing_street, member.billing_city, 
            member.billing_postal_code)
        billingScreen.fillMiddleName(member.billing_middle_name)
        billingScreen.fillCountry(member.billing_country)
        billingScreen.fillProvince(member.billling_state)
        billingScreen.continue();
        validateThankYouPage(consts.one_year_membership_fee, consts.min_additionlal_contribution, consts.one_year_membership_fee + consts.min_additionlal_contribution, member.first_name,  member.billing_middle_name, member.last_name, member.email, member.street, member.postal_code, member.billing_first_name, member.billing_last_name,
            member.billing_city, member.billing_street, member.billing_postal_code, member.expected_billing_country, member.expected_billing_state, member.one_year_expected_card_number, member.expected_expiration_date) 
    })

    it('Standart membership, dollar option, only required fields filled', () => {
        amountScreen.chooseStandartMembership()
        amountScreen.chooseDollarOption();
        billingScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        billingScreen.continue()
        billingScreen.fillCreditCard(member.one_year_card_number, member.security_code, member.expiration_year, member.expiration_month);
        billingScreen.uncheckBillingAddressTheSame()
        billingScreen.fillRequiredAddressFieldsWithoutCountryProvince(member.billing_first_name, member.billing_last_name, member.billing_street, member.billing_city, 
            member.billing_postal_code);
        billingScreen.fillCountry(member.billing_country)
        billingScreen.fillProvince(member.billling_state)
        billingScreen.continue();
        validateThankYouPage(consts.one_year_membership_fee, amountScreen.chosenAdditionalContribution, consts.one_year_membership_fee + amountScreen.chosenAdditionalContribution,
             member.first_name,"", member.last_name, member.email, member.street, member.postal_code, member.billing_first_name, member.billing_last_name,
            member.billing_city, member.billing_street, member.billing_postal_code, member.expected_billing_country, member.expected_billing_state, member.one_year_expected_card_number, 
            member.expected_expiration_date) 
    })

    it('Three-Year Membership, No additional contribution, billing address is the same', () => {
        amountScreen.chooseThreeYearsMembership()
        amountScreen.chooseNoContribution();
        billingScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        billingScreen.continue()
        billingScreen.fillCreditCard(member.three_years_card_number, member.security_code, member.expiration_year, member.expiration_month);
        billingScreen.checkBillingAddressTheSame()
        billingScreen.continue();
        validateThankYouPage(consts.three_years_memership_fee, NaN, NaN, member.first_name,"", member.last_name, member.email, 
            member.street, member.postal_code, member.first_name, member.last_name,
            member.city, member.street, member.postal_code, consts.default_country, consts.default_state, member.three_years_expected_card_number, member.expected_expiration_date) 
    })

    it('Three-Year Membership, Other amount>min amount', () => {
        amountScreen.chooseThreeYearsMembership()
        let amount = Math.floor(consts.min_additionlal_contribution + Math.random()*(300 - consts.min_additionlal_contribution + 1))
        amountScreen.enterOtherAmount(amount.toString());
        billingScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        billingScreen.continue()
        billingScreen.fillCreditCard(member.three_years_card_number, member.security_code, member.expiration_year, member.expiration_month);
        billingScreen.checkBillingAddressTheSame()
        billingScreen.continue();
        validateThankYouPage(consts.three_years_memership_fee, amount, amount + consts.three_years_memership_fee, member.first_name, "", member.last_name, 
            member.email, member.street, member.postal_code, member.first_name, member.last_name,
            member.city, member.street, member.postal_code, consts.default_country, consts.default_state, member.three_years_expected_card_number, member.expected_expiration_date) 
    })
})

function validateThankYouPage(expectedMembershipAmount: number, expectedAdditionalContributionAmount: number, expectedTotalContribution: number, expectedFirstName: string, expectedMiddleName: string, expectedLastName: string, expectedEmail:string, expectedStreet: string, expectedPostalCode: string,
    expectedBillingFirstName: string, expectedBillingLastName: string, expectedBillingCity: string, expectedBillingStreet: string, expectedBillingPostalCode: string,
    expectedBillingCountry: string, expectedBillingState: string, expectedCardNumber: string, expectedExpirationDate:string) {
    thankYouPage.pageTitle.then(() => {
        validateAmount(expectedMembershipAmount, expectedAdditionalContributionAmount, expectedTotalContribution)
        validatePersonalInfo(expectedFirstName, expectedLastName, expectedEmail, expectedStreet, expectedPostalCode)
        validateBillingInfo(expectedMiddleName, expectedBillingFirstName, expectedBillingLastName, expectedBillingCity, expectedBillingStreet, expectedBillingPostalCode, expectedBillingCountry, expectedBillingState)
        validateCard(expectedCardNumber, expectedExpirationDate) 
    })
}
function validateAmount(expectedMembershipAmount: number, expectedAdditionalContributionAmount: number, expectedTotalContribution: number) {
    thankYouPage.getTransactionAmount().then((amount) => { }).
        should('deep.equal', {
            membershipAmount: expectedMembershipAmount, additionalContributionAmount: expectedAdditionalContributionAmount,
            totalContribution: expectedTotalContribution
        })
}

function validatePersonalInfo(expectedFirstName: string, expectedLastName: string, expectedEmail: string, expectedStreet: string, expectedPostalCode: string) {
    thankYouPage.getFirstName().should('eq', expectedFirstName)
    thankYouPage.getLastName().should('eq', expectedLastName)
    thankYouPage.getEmail().should('eq', expectedEmail)
    thankYouPage.getStreet().should('eq', expectedStreet)
    thankYouPage.getPostalCode().should('eq', expectedPostalCode)
}

function validateBillingInfo(expectedMiddleName: string, expectedBillingFirstName: string, expectedBillingLastName: string, expectedBillingCity: string, 
    expectedBillingStreet: string, expectedBillingPostalCode: string, expectedBillingCountry: string, expectedBillingState: string) {
    let expectedFullName: string
    if (expectedMiddleName === "") {
        expectedFullName =  expectedBillingFirstName + ' ' + expectedBillingLastName
    } else {
        expectedFullName = expectedBillingFirstName + ' ' + expectedMiddleName + ' ' + expectedBillingLastName
    }
    thankYouPage.getBillingName().should('eq', expectedFullName)
    thankYouPage.getBillingAddress().should('contain', expectedBillingCity)
    thankYouPage.getBillingAddress().should('contain', expectedBillingStreet)
    thankYouPage.getBillingAddress().should('contain', expectedBillingPostalCode)
    thankYouPage.getBillingAddress().should('contain', expectedBillingCountry)
    thankYouPage.getBillingAddress().should('contain', expectedBillingState)
}

function validateCard(expectedCardNumber: string, expectedExpirationDate: string) {
    thankYouPage.getCardNumber().should('eq', expectedCardNumber)
    thankYouPage.getCardExpirationDate().should('contain', expectedExpirationDate)
}

