import {billingScreen} from '../pages/join.party.billing.screen'
import {mainPage} from '../pages/main.page'
import { amountScreen } from '../pages/join.party.amount.screen'
import { personalInfoScreen } from '../pages/join.party.personal.info.screen'

import member from '../../../fixtures/member.json'

describe('Check if personal info fields are required', () => {

    before(()=>{
        cy.fixture('member.json').as('member')
        cy.openMainPage();
       // mainPage.becomeMemberClick()
        amountScreen.chooseStandartMembership()
        amountScreen.continue()
    })

    beforeEach(() => {
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
    })

    it('Without first name', () => {
        personalInfoScreen.clearFirstName()
        billingScreen.continue()
        personalInfoScreen.firstNameError.should('be.visible')
    })

    it('Without last name', () => {
        personalInfoScreen.clearLastName()
        billingScreen.continue()
        personalInfoScreen.lastNameError.should('be.visible')
    })

    it('Without email', () => {
        personalInfoScreen.clearEmail()
        billingScreen.continue()
        personalInfoScreen.emailError.should('be.visible')
    })

    it('Without street', () => {
        personalInfoScreen.clearStreet()
        billingScreen.continue()
        personalInfoScreen.streetError.should('be.visible')
    })

    it('Without city', () => {
        personalInfoScreen.clearCity()
        billingScreen.continue()
        personalInfoScreen.cityError.should('be.visible')
    })

    it('Without postal code', () => {
        personalInfoScreen.clearPostalCode()
        billingScreen.continue()
        personalInfoScreen.postalCodeError.should('be.visible')
    })
})

describe('Check if card fields are required', ()=>{
    before(()=>{
        cy.fixture('member.json').as('member')
        cy.openMainPage();
       // mainPage.becomeMemberClick()
        amountScreen.chooseStandartMembership()
        amountScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        amountScreen.continue()
    })    

    beforeEach(() => {
        billingScreen.fillCreditCard(member.one_year_card_number, member.security_code, member.expiration_year, member.expiration_month)
        billingScreen.checkBillingAddressTheSame()
    })

    it('Without card number', () => {
        billingScreen.clearCardNumber()
        billingScreen.cardNumberError.should('be.visible')
    })

    it('Without card security code', () => {
        billingScreen.clearSecurityCode()
        billingScreen.securityCodeError.should('be.visible')
    })

    it('Without card expiration month', () => {
        billingScreen.clearExpirationMonth()
        billingScreen.continue()
        billingScreen.expirationMonthError.should('be.visible')
    })

    it('Without card expiration year', () => {
        billingScreen.clearExpirationYear()
        billingScreen.continue()
        billingScreen.expirationYearError.should('be.visible')
    })
} )

describe('Check if billing address fields are required', ()=>{
    before(()=>{
        cy.fixture('member.json').as('member')
        cy.openMainPage();
       // mainPage.becomeMemberClick()
        amountScreen.chooseStandartMembership()
        amountScreen.continue()
        personalInfoScreen.fillPersonalInfo(member.first_name, member.last_name, member.email, member.street, member.city, member.postal_code);
        amountScreen.continue()
        billingScreen.fillCreditCard(member.one_year_card_number, member.security_code, member.expiration_year, member.expiration_month)
        billingScreen.uncheckBillingAddressTheSame()
    })    

    beforeEach(() => {
        billingScreen.fillRequiredAddressFieldsWithoutCountryProvince(member.billing_first_name, member.billing_last_name, member.billing_street, member.billing_city, 
            member.billing_postal_code);
            billingScreen.fillMiddleName(member.billing_middle_name)
            billingScreen.fillCountry(member.billing_country)
            billingScreen.fillProvince(member.billling_state)
    })

    it('Without billing first name',()=>{
        billingScreen.clearFirstName()
        billingScreen.continue()
        billingScreen.firstNameError.should('be.visible')
    })

    it('Without billing last name',()=>{
        billingScreen.clearLastName()
        billingScreen.continue()
        billingScreen.lastNameError.should('be.visible')
    })

    it('Without billing street',()=>{
        billingScreen.clearStreet()
        billingScreen.continue()
        billingScreen.streetError.should('be.visible')
    })

    it('Without billing city',()=>{
        billingScreen.clearCity()
        billingScreen.continue()
        billingScreen.cityError.should('be.visible')
    })

    it('Without billing postal code',()=>{
        billingScreen.clearPostalCode()
        billingScreen.continue()
        billingScreen.postalCodeError.should('be.visible')
    })
})