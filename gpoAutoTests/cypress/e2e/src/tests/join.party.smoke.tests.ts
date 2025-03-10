import { thankYouPage } from '../components/thank.you.page'
import { joinPartyPage } from '../components/join.party.page'

import consts from '../../../consts.json'
import { personalInfo } from '../../testData/test.data'
import { billingInfo } from '../../testData/test.data'
import { BillingInfo } from '../../testData/test.data'
import { PersonalInfo } from '../../testData/test.data'
import { Card } from '../../testData/test.data'
import { oneYearCard } from '../../testData/test.data'
import { threeYearsCard } from '../../testData/test.data'


describe('Join party (Become a Member), smoke tests', () => {

    beforeEach(() => {
        cy.openNewMembershipPage();
    })

    it(`Standart membership, other amount=min amount, all fields filled
            1. Choose Standart Membership
            2. In the "Other Amount" enter min allowed amount
            3. Fill the fields with valid data 
            4. Uncheck "My billing address is the same as above" and fill all the billing address fields
            5. Click "Contribute"
        Expected results:
            Transaction is successful, all information is as entered`, () => {

        joinPartyPage.amountTab.chooseStandartMembership()
        joinPartyPage.amountTab.enterOtherAmount(consts.min_additionlal_contribution.toString());
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
        joinPartyPage.billingTab.enterCreditCard(oneYearCard);
        joinPartyPage.billingTab.uncheckBillingAddressTheSame()
        joinPartyPage.billingTab.enterBillingInfo(billingInfo)
        joinPartyPage.continue();
        validateThankYouPage(personalInfo, oneYearCard, billingInfo, consts.one_year_membership_fee, cy.wrap(consts.min_additionlal_contribution))
    })

    it(`Standart membership, dollar option
        1. Choose Standart Membership
        2. In the "Additional contribution" choose first of the dollar options
        3. Fill the fields with valid data 
        4. Uncheck "My billing address is the same as above" and fill the billing address fields
        5. Click "Contribute"
    Expected results:
        Transaction is successful, all information is as entered`, () => {

        joinPartyPage.amountTab.chooseStandartMembership()
        const dollar = joinPartyPage.amountTab.chooseFirstDollarOption();
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
        joinPartyPage.billingTab.enterCreditCard(oneYearCard);
        joinPartyPage.billingTab.uncheckBillingAddressTheSame()
        joinPartyPage.billingTab.enterBillingInfo(billingInfo);
        joinPartyPage.continue();
        validateThankYouPage(personalInfo, oneYearCard, billingInfo, consts.one_year_membership_fee, dollar)
    })

    it(`Three-Year Membership, No additional contribution, billing address is the same
        1. Choose Three-Year Membership
        2. In the "Additional contribution" choose "No thank you"
        3. Check "My billing address is the same as above"
        4. Click "Contribute"
    Expected results:
        after step 3: Billing information fields are filled with the personal info automatically
        after step 4: Transaction is successful, all information is as entered`, () => {

        joinPartyPage.amountTab.chooseThreeYearsMembership()
        joinPartyPage.amountTab.chooseNoContribution();
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
        joinPartyPage.billingTab.enterCreditCard(threeYearsCard);
        joinPartyPage.billingTab.checkBillingAddressTheSame()
        joinPartyPage.continue();
        const expectedBillingInfo: BillingInfo = {
            personalInfo: personalInfo,
            expectedCountry: consts.default_country,
            expectedState: consts.default_state,
            country: "",
            state: ""
        }
        validateThankYouPage(personalInfo, threeYearsCard, expectedBillingInfo, consts.three_years_memership_fee, cy.wrap(NaN))
    })

    it(`Three-Year Membership, Other amount>min amount
        1. Choose Three-Year Membership
        2. In the "Additional contribution" choose "Other amount" and enter a value>min allowed amount
        3. Check "My billing address is the same as above"
        4. Click "Contribute"
    Expected results:
        after step 3: Billing information fields are filled with the personal info automatically
        after step 4: Transaction is successful, all information is as entered`, () => {

        joinPartyPage.amountTab.chooseThreeYearsMembership()
        const amount = Math.floor(consts.min_additionlal_contribution + Math.random() * (300 - consts.min_additionlal_contribution + 1))
        joinPartyPage.amountTab.enterOtherAmount(amount.toString());
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
        joinPartyPage.billingTab.enterCreditCard(threeYearsCard);
        joinPartyPage.billingTab.checkBillingAddressTheSame()
        joinPartyPage.continue();
        const expectedBillingInfo: BillingInfo = {
            personalInfo: personalInfo,
            expectedCountry: consts.default_country,
            expectedState: consts.default_state,
            country: "",
            state: ""
        }
        validateThankYouPage(personalInfo, threeYearsCard, expectedBillingInfo, consts.three_years_memership_fee, cy.wrap(amount))
    })

    const costOptions = [1, 2, 3, 4, 5, 6]
    costOptions.forEach((option) => {
        it(`Validation of the "Your contribution"
            1. Choose standart membership
            2. Choose the first dollar option
            3. Verify the "Your contribution" number
            4. Repeat steps 2-3 for all dollar options
        Expected result:
            "Your contribution" number equals dollar option plus standart membership`, () => {
            joinPartyPage.amountTab.chooseStandartMembership()
            joinPartyPage.amountTab.chooseDollarOption(option).then((amount) => {
                joinPartyPage.amountTab.getYourContribution().should('eq', consts.one_year_membership_fee + amount)
            })
        })
    })
})

function validateThankYouPage(personalInfo: PersonalInfo, card: Card, billingInfo: BillingInfo,
    expectedMembershipAmount: number, expectedAdditionalContributionAmount: Cypress.Chainable<number>) {
    thankYouPage.pageTitle.then(() => {
        validateAmount(expectedMembershipAmount, expectedAdditionalContributionAmount)
        validatePersonalInfo(personalInfo)
        validateBillingInfo(billingInfo)
        validateCard(card)
    })
}
function validateAmount(expectedMembershipAmount: number, expectedAdditionalContributionAmount: Cypress.Chainable<number>) {
    thankYouPage.getTransactionAmount().then(transactionAmount => {
        expectedAdditionalContributionAmount.then(expectedAdditionContribution => {
            expect(transactionAmount).to.deep.equal({
                membershipAmount: expectedMembershipAmount,
                additionalContributionAmount: expectedAdditionContribution,
                totalContribution: expectedMembershipAmount + expectedAdditionContribution
            })
        })
    })
}

function validatePersonalInfo(personalInfo: PersonalInfo) {
    thankYouPage.getFirstName().should('eq', personalInfo.firstName)
    thankYouPage.getLastName().should('eq', personalInfo.lastName)
    thankYouPage.getEmail().should('eq', personalInfo.email)
    thankYouPage.getStreet().should('eq', personalInfo.street)
    thankYouPage.getPostalCode().should('eq', personalInfo.postalCode)
}

function validateBillingInfo(billingInfo: BillingInfo) {
    const fullName: string = `${billingInfo.personalInfo.firstName} ${billingInfo.personalInfo.lastName}`
    thankYouPage.getBillingName().should('eq', fullName)
    thankYouPage.getBillingAddress().should('contain', billingInfo.personalInfo.city)
    thankYouPage.getBillingAddress().should('contain', billingInfo.personalInfo.street)
    thankYouPage.getBillingAddress().should('contain', billingInfo.personalInfo.postalCode)
    thankYouPage.getBillingAddress().should('contain', billingInfo.expectedCountry)
    thankYouPage.getBillingAddress().should('contain', billingInfo.expectedState)
}

function validateCard(card: Card) {
    const expectedCardNumber = card.number.slice(-4).padStart(card.number.length, '*');
    thankYouPage.getCardNumber().should('eq', expectedCardNumber)
    thankYouPage.getCardExpirationDate().should('contain', card.expectedExpirationDate)
}

