
class AmountTabComponent {
    private get additionalContribution1() { return cy.get('.contribution_amount-row1').find('.crm-price-amount-amount') }
    private get additionalContribution2() { return cy.get('.contribution_amount-row2').find('.crm-price-amount-amount') }
    private get additionalContribution3() { return cy.get('.contribution_amount-row3').find('.crm-price-amount-amount') }
    private get additionalContribution4() { return cy.get('.contribution_amount-row4').find('.crm-price-amount-amount') }
    private get additionalContribution5() { return cy.get('.contribution_amount-row5').find('.crm-price-amount-amount') }
    private get additionalContribution6() { return cy.get('.contribution_amount-row6').find('.crm-price-amount-amount') }
    private get additionalContributionNone() { return cy.get('.contribution_amount-row7') }
    private get otherAmountInput() { return cy.get('#price_131') }
    private get standartMembership() { return cy.get('.membership_amount-row1 > .price-set-option-content > label > .crm-price-amount-label') }
    private get threeYearsMembership() { return cy.get('.membership_amount-row2 > .price-set-option-content > label > .crm-price-amount-label') }
    private get yourContribution() { return cy.get('#donation-total') }

    public getYourContribution() {
        return this.yourContribution.then((e) => Number(e.text().replace('$ ', '')))
    }

    public chooseFirstDollarOption() {
        return this.additionalContribution1.click().then((e) => Number(e.text().replace('$ ', '')))
    }

    public chooseDollarOption(option: number) {
        const chooseOption: Record<number, () => Cypress.Chainable<number>> = {
            1: () => this.additionalContribution1.click().then((e) => Number(e.text().replace('$ ', ''))),
            2: () => this.additionalContribution2.click().then((e) => Number(e.text().replace('$ ', ''))),
            3: () => this.additionalContribution3.click().then((e) => Number(e.text().replace('$ ', ''))),
            4: () => this.additionalContribution4.click().then((e) => Number(e.text().replace('$ ', ''))),
            5: () => this.additionalContribution5.click().then((e) => Number(e.text().replace('$ ', ''))),
            6: () => this.additionalContribution6.click().then((e) => Number(e.text().replace('$ ', '')))
        }
        return chooseOption[option]?.()
    }

    public chooseThreeYearsMembership() {
        this.threeYearsMembership.click()
    }

    public chooseStandartMembership() {
        this.standartMembership.click()
    }

    public chooseNoContribution() {
        this.additionalContributionNone.click()
    }

    public enterOtherAmount(amount: string) {
        this.otherAmountInput.click().clear().type(amount)
    }
}

export const amountTab: AmountTabComponent = new AmountTabComponent()