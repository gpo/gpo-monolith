class JoinPartyBillingScreen {
   
    private get cardNumber() {return cy.get('#credit_card_number')}
    private get securityCode() {return cy.get('#cvv2')}
    private get expirationMonth() {return cy.get('#credit_card_exp_date_M')}
    private  get expirationYear() {return cy.get('#credit_card_exp_date_Y')}
    private get firstName() {return cy.get('#billing_first_name')}
    private get middleName() {return cy.get('#billing_middle_name')}
    private get lastName() {return cy.get('#billing_last_name')}
    private get street() {return cy.get('#billing_street_address-5')}
    private get city() {return cy.get('#billing_city-5')}
    private get country() {return cy.get('#billing_country_id-5')}
    private  get stateProvince() {return cy.get('#billing_state_province_id-5')}
    private  get postalCode() {return cy.get('#billing_postal_code-5')}
    private get continueButton() {return cy.get('#nextTab')}
    private get billingCheckbox() {return cy.get('#billingcheckbox')}
    public get cardNumberError(){return cy.get('#credit_card_number-error')}
    public get expirationMonthError(){return cy.get('#credit_card_exp_date_M-error')}
    public get expirationYearError(){return cy.get('#credit_card_exp_date_Y-error')}
    public get securityCodeError() {return cy.get('#cvv2-error')}
    public get firstNameError() {return cy.get('#billing_first_name-error')}
    public get lastNameError() {return cy.get('#billing_last_name-error')}
    public get streetError() {return cy.get('#billing_street_address-5-error')}
    public get cityError() {return cy.get('#billing_city-5-error')}
    public get postalCodeError() {return cy.get('#billing_postal_code-5-error')}
    private get provinceDown() {return cy.get('#s2id_billing_state_province_id-5 > .select2-choice > .select2-arrow')}
    private get countryDown() {return cy.get('#s2id_billing_country_id-5')}

    public clearFirstName() {
        this.firstName.clear()
    }

    public clearLastName(){
        this.lastName.clear()
    }

    public clearStreet() {
        this.street.clear()
    }

    public clearCity() {
        this.city.clear()
    }

    public clearPostalCode() {
        this.postalCode.clear()
    }

    public clearSecurityCode() {
        this.securityCode.clear()
    }

    public clearCardNumber(){
        this.cardNumber.clear()
    }

    public clearExpirationMonth() {
        this.expirationMonth.select('-month-')
    }

    public clearExpirationYear() {
        this.expirationYear.select('-year-')
    }
       
    public enterLettersInCountryField(letters:string) {
        this.country.type(letters)
    }

    public enterLettersInStateField(letters:string) {
        this.stateProvince.type(letters)
    }

    public checkBillingAddressTheSame() {
        this.billingCheckbox.check()
    }

    public uncheckBillingAddressTheSame() {
        this.billingCheckbox.uncheck()
    }

    public continue() {
        this.continueButton.click()
    }

    public fillCreditCard(cardNumber:string, securityCode:string, expirationYear:string, expirationMonth: string) {
        this.cardNumber.click().type(cardNumber)
        this.securityCode.click().type(securityCode)
        this.expirationMonth.select(expirationMonth)
        this.expirationYear.select(expirationYear)
    }

    public fillMiddleName(middleName: string) {
        this.middleName.click().clear().type(middleName)       
    }

    public fillCountry(country:string) {
        this.countryDown.click();
        this.country.select(country, {force: true});
    }

    public fillProvince(province:string) {
         this.provinceDown.click()
        this.stateProvince.select(province, {force: true})
    }
    
    public fillRequiredAddressFieldsWithoutCountryProvince(firstName: string, lastName: string, street:string, city:string, postalCode:string) {
            this.firstName.clear().type(firstName)
            this.lastName.clear().type(lastName)
            this.street.clear().type(street)
            this.city.clear().type(city)
            this.postalCode.clear().type(postalCode)
    }
}

export const billingScreen: JoinPartyBillingScreen = new JoinPartyBillingScreen()
