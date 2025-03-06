class ThankYouPage {
    get pageTitle() { return cy.get('#block-gpo24-page-title', { timeout: 40000 }) }
    private get successTransaction() { return cy.get('#help').find('div').first() }
    private get emailWasSent() { return cy.get('#help').find('div').eq(1) }
    private get membershipTransaction() { return cy.get('.amount_display-group').find('.content') }
    private get firstName() { return cy.get('#editrow-first_name').find('.crm-frozen-field') }
    private get lastName() { return cy.get('#editrow-last_name').find('.crm-frozen-field') }
    private get email() { return cy.get('#editrow-email-Primary').find('.crm-frozen-field') }
    private get street() { return cy.get('#editrow-street_address-Primary').find('.crm-frozen-field') }
    private get city() { return cy.get('#editrow-city-Primary').find('.crm-frozen-field') }
    private get postalCode() { return cy.get('#editrow-postal_code-Primary').find('.crm-frozen-field') }
    private get billingName() { return cy.get('.billing_name-section').find('.content') }
    private get billingAddress() { return cy.get('.billing_address-section').find('.content') }
    private get cardNumber() { return cy.get('.credit_card_details-section').find('.content').eq(1) }
    private get cardExpirationDate() { return cy.get('.credit_card_details-section').find('.content').eq(2) }

    public getTransactionAmount() {
        return this.membershipTransaction.invoke('text').then((text) => {
            const matches = text.match(/\$(\d+\.\d{2})/g);
            let membershipAmount: number = 0;
            let additionalContributionAmount: number = 0;
            let totalContribution: number = 0;
            if (matches) {
                const values = matches.map(value => value.replace('$', '')); // Remove the dollar sign
                membershipAmount = Number(values[0])
                additionalContributionAmount = Number(values[1])
                totalContribution = Number(values[2])
            }
            return { membershipAmount, additionalContributionAmount, totalContribution }
        })
    }

    public getSuccessTransaction() {
        return this.successTransaction.invoke('text')
    }

    public getEmailWasSent() {
        return this.emailWasSent.invoke('text')
    }

    public getFirstName() {
        return this.firstName.invoke('text')
    }

    public getLastName() {
        return this.lastName.invoke('text')
    }

    public getEmail() {
        return this.email.invoke('text')
    }

    public getStreet() {
        return this.street.invoke('text')
    }

    public getPostalCode() {
        return this.postalCode.invoke('text')
    }

    public getBillingName() {
        return this.billingName.invoke('text')
    }

    public getBillingAddress() {
        return this.billingAddress.invoke('text')
    }

    public getCardNumber() {
        return this.cardNumber.invoke('text')
    }

    public getCardExpirationDate() {
        return this.cardExpirationDate.invoke('text')
    }

}

export const thankYouPage: ThankYouPage = new ThankYouPage()