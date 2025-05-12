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


describe(`1. Open the new membership page, 
    2. Procced to the personal info tab
    3. Verify personal info fields are required`, () => {

before(() => {
cy.openNewMembershipPage();
joinPartyPage.amountTab.chooseStandartMembership()
joinPartyPage.continue()
})

beforeEach(() => {
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
})

it('Without first name', () => {
joinPartyPage.personalInfoTab.clearFirstName()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.firstNameError.should('be.visible')
})

it('Without last name', () => {
joinPartyPage.personalInfoTab.clearLastName()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.lastNameError.should('be.visible')
})

it('Without email', () => {
joinPartyPage.personalInfoTab.clearEmail()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.emailError.should('be.visible')
})

it('Without street', () => {
joinPartyPage.personalInfoTab.clearStreet()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.streetError.should('be.visible')
})

it('Without city', () => {
joinPartyPage.personalInfoTab.clearCity()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.cityError.should('be.visible')
})

it('Without postal code', () => {
joinPartyPage.personalInfoTab.clearPostalCode()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.postalCodeError.should('be.visible')
})
})

describe(`1. Open the new membership page
    2. proceed to the payment tab
    3. Verify card fields are required`, () => {
before(() => {
cy.openNewMembershipPage();
joinPartyPage.amountTab.chooseStandartMembership()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.continue()
})

beforeEach(() => {
joinPartyPage.billingTab.enterCreditCard(oneYearCard)
joinPartyPage.billingTab.checkBillingAddressTheSame()
})

it('Without card number', () => {
joinPartyPage.billingTab.clearCardNumber()
joinPartyPage.billingTab.cardNumberError.should('be.visible')
})

it('Without card security code', () => {
joinPartyPage.billingTab.clearSecurityCode()
joinPartyPage.billingTab.securityCodeError.should('be.visible')
})

it('Without card expiration month', () => {
joinPartyPage.billingTab.clearExpirationMonth()
joinPartyPage.continue()
joinPartyPage.billingTab.expirationMonthError.should('be.visible')
})

it('Without card expiration year', () => {
joinPartyPage.billingTab.clearExpirationYear()
joinPartyPage.continue()
joinPartyPage.billingTab.expirationYearError.should('be.visible')
})
})

describe(`1. Open the new membership page, 
    2. Proceed to the Payment
    3. Uncheck "My billing address is the same as above"
    4. Verify billing address fields are required`, () => {
before(() => {
cy.openNewMembershipPage()
joinPartyPage.amountTab.chooseStandartMembership()
joinPartyPage.continue()
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.continue()
joinPartyPage.billingTab.enterCreditCard(oneYearCard)
joinPartyPage.billingTab.uncheckBillingAddressTheSame()
})

beforeEach(() => {
joinPartyPage.billingTab.enterBillingInfo(billingInfo);
})

it('Without billing first name', () => {
joinPartyPage.billingTab.clearFirstName()
joinPartyPage.continue()
joinPartyPage.billingTab.firstNameError.should('be.visible')
})

it('Without billing last name', () => {
joinPartyPage.billingTab.clearLastName()
joinPartyPage.continue()
joinPartyPage.billingTab.lastNameError.should('be.visible')
})

it('Without billing street', () => {
joinPartyPage.billingTab.clearStreet()
joinPartyPage.continue()
joinPartyPage.billingTab.streetError.should('be.visible')
})

it('Without billing city', () => {
joinPartyPage.billingTab.clearCity()
joinPartyPage.continue()
joinPartyPage.billingTab.cityError.should('be.visible')
})

it('Without billing postal code', () => {
joinPartyPage.billingTab.clearPostalCode()
joinPartyPage.continue()
joinPartyPage.billingTab.postalCodeError.should('be.visible')
})
})

describe(`Email validation
1. Open the new membership page,
2. Procced to the personal info tab,
3. Verify email format `, () => {
before(() => {
cy.openNewMembershipPage();
joinPartyPage.amountTab.chooseStandartMembership()
joinPartyPage.continue()
})

beforeEach(() => {
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.personalInfoTab.clearEmail()
})

it('Email without @', () => {
joinPartyPage.personalInfoTab.enterEmail(personalInfo.email.replace('@',''))
joinPartyPage.continue()
joinPartyPage.personalInfoTab.emailError.should('be.visible')
})

it('Email without .', () => {
joinPartyPage.personalInfoTab.enterEmail(personalInfo.email.replace('.',''))
joinPartyPage.continue()
joinPartyPage.personalInfoTab.emailError.should('be.visible')
})
})

describe( `Other amount validation
    1. Open the new membership page,
    2. Choose Other amount option
    3. Enter other amount accordingly
    4. Proceed to the Submit button
    5. Click Submit
Expected results: Error message, transaction is not complete`, () => {
before(() => {
cy.openNewMembershipPage();
joinPartyPage.amountTab.chooseStandartMembership()
})

it('Other amount is less than min amount', ()=> {
joinPartyPage.amountTab.enterOtherAmount((consts.min_additionlal_contribution-0.1).toString())
joinPartyPage.continue()
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.continue()
joinPartyPage.billingTab.enterCreditCard(oneYearCard);
joinPartyPage.billingTab.checkBillingAddressTheSame()
joinPartyPage.continue()
joinPartyPage.amountTab.otherAmountError.should('be.visible')
})

it('Other amount is more than max amount for 1 year', ()=> {
joinPartyPage.amountTab.enterOtherAmount((consts.max_other_amount+0.1).toString())
joinPartyPage.continue()
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.continue()
joinPartyPage.billingTab.enterCreditCard(oneYearCard);
joinPartyPage.billingTab.checkBillingAddressTheSame()
joinPartyPage.continue()
joinPartyPage.amountTab.otherAmountError.should('be.visible')
})

it('Other amount is more than max amount for 3 years', ()=> {
joinPartyPage.amountTab.enterOtherAmount((consts.max_other_amount+0.1).toString())
joinPartyPage.continue()
joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
joinPartyPage.continue()
joinPartyPage.billingTab.enterCreditCard(oneYearCard);
joinPartyPage.billingTab.checkBillingAddressTheSame()
joinPartyPage.continue()
joinPartyPage.amountTab.otherAmountError.should('be.visible')
})
})


describe('Join party (Become a Member), smoke tests', { tags: '@smoke' }, () => {

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

