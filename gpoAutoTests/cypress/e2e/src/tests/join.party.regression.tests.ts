import { joinPartyPage } from '../components/join.party.page'
import { personalInfo } from '../../testData/test.data';
import { oneYearCard } from '../../testData/test.data';
import { billingInfo } from '../../testData/test.data';

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