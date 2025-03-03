import { joinPartyPage } from '../pages/join.party.page'
import { PersonalInfo } from './join.party.smoke.tests'
import { Card } from './join.party.smoke.tests'
import { BillingInfo } from './join.party.smoke.tests'

import member from '../../../fixtures/member.json'

let personalInfo: PersonalInfo = {
    firstName: member.personalInfo.firstName,
    lastName: member.personalInfo.lastName,
    email: member.personalInfo.email,
    street: member.personalInfo.street,
    city: member.personalInfo.city,
    postalCode: member.personalInfo.postalCode
}

let card: Card = {
    oneYearNumber: member.card.oneYearCardNumber,
    securityCode: member.card.securityCode,
    expirationMonth: member.card.expirationMonth,
    expirationYear: member.card.expirationYear,
    expectedExpirationDate: member.card.expectedExpirationDate
}

let billingInfo: BillingInfo = {
    personalInfo : {
        firstName: member.billingInfo.firstName,
        lastName: member.billingInfo.lastName,
        street: member.billingInfo.street,
        city: member.billingInfo.city,
        postalCode: member.billingInfo.postalCode,
        email: ""
    },
    country: member.billingInfo.country,
    state: member.billingInfo.state,
    expectedCountry: member.billingInfo.expectedCountry,
    expectedState: member.billingInfo.expectedState
}

describe(`1. Open the new membership page, 
            2. Procced to the personal info tab
            3. Verify personal info fields are required`, () => {

    before(()=>{
        cy.fixture('member.json').as('member')
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
            3. Verify card fields are required`, ()=>{
    before(()=>{
        cy.fixture('member.json').as('member')
        cy.openNewMembershipPage();
        joinPartyPage.amountTab.chooseStandartMembership()
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
    })    

    beforeEach(() => {
        joinPartyPage.billingTab.enterCreditCard(card)
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
} )

describe(`1. Open the new membership page, 
            2. Proceed to the Payment
            3. Uncheck "My billing address is the same as above"
            4. Verify billing address fields are required`, ()=>{
    before(()=>{
        cy.fixture('member.json').as('member')
        cy.openNewMembershipPage()
        joinPartyPage.amountTab.chooseStandartMembership()
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
        joinPartyPage.billingTab.enterCreditCard(card)
        joinPartyPage.billingTab.uncheckBillingAddressTheSame()
    })    

    beforeEach(() => {
        joinPartyPage.billingTab.enterBillingInfo(billingInfo);
    })

    it('Without billing first name',()=>{
        joinPartyPage.billingTab.clearFirstName()
        joinPartyPage.continue()
        joinPartyPage.billingTab.firstNameError.should('be.visible')
    })

    it('Without billing last name',()=>{
        joinPartyPage.billingTab.clearLastName()
        joinPartyPage.continue()
        joinPartyPage.billingTab.lastNameError.should('be.visible')
    })

    it('Without billing street',()=>{
        joinPartyPage.billingTab.clearStreet()
        joinPartyPage.continue()
        joinPartyPage.billingTab.streetError.should('be.visible')
    })

    it('Without billing city',()=>{
        joinPartyPage.billingTab.clearCity()
        joinPartyPage.continue()
        joinPartyPage.billingTab.cityError.should('be.visible')
    })

    it('Without billing postal code',()=>{
        joinPartyPage.billingTab.clearPostalCode()
        joinPartyPage.continue()
        joinPartyPage.billingTab.postalCodeError.should('be.visible')
    })
})