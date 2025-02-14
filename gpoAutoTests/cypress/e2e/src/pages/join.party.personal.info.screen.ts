class JoinPartyPersonalInfoScreen {
    private get firstName() {return cy.get('#first_name')}
    private get lastName() {return cy.get('#last_name')}
    private get email() {return cy.get('#email-Primary')}
    private get street() {return cy.get('#street_address-Primary')}
    private get city() {return cy.get('#city-Primary')}
    private get postalCode() {return cy.get('#postal_code-Primary')}
    public get firstNameError() {return cy.get('#first_name-error')}
    public get lastNameError() {return cy.get('#last_name-error')}
    public get emailError() {return cy.get('#email-Primary-error')}
    public get streetError() {return cy.get('#street_address-Primary-error')}
    public get cityError() {return cy.get('#city-Primary-error')}
    public get postalCodeError() {return cy.get('#postal_code-Primary-error')}

   
    public clearFirstName() {
        this.firstName.click().clear()
    }

    public clearLastName() {
        this.lastName.click().clear()
    }

    public clearEmail() {
        this.email.click().clear()
    }

    public clearStreet() {
        this.street.click().clear()
    }

    public clearCity() {
        this.city.click().clear()
    }

    public clearPostalCode(){
        this.postalCode.click().clear()
    }

    public fillPersonalInfo(firstName: string, lastName: string, email:string, street:string, city:string, postalCode:string) {
        this.firstName.click().clear().type(firstName);
        this.lastName.click().clear().type(lastName)
        this.email.click().clear().type(email)
        this.street.click().clear().type(street)
        this.city.click().clear().type(city)
        this.postalCode.click().clear().type(postalCode)
    }
}

export const personalInfoScreen: JoinPartyPersonalInfoScreen = new JoinPartyPersonalInfoScreen()