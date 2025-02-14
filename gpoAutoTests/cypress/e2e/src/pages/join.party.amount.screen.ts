class JoinPartyAmountScreen {
    private get additionalContribution10() {return cy.get('.contribution_amount-row1').find('.crm-price-amount-amount')}
    private get additionalContribution25() {return cy.get('.contribution_amount-row2').find('.crm-price-amount-amount')}
    private get additionalContribution50() {return cy.get('.contribution_amount-row3').find('.crm-price-amount-amount')}
    private get additionalContribution100() {return cy.get('.contribution_amount-row4').find('.crm-price-amount-amount')}
    private get additionalContribution200() {return cy.get('.contribution_amount-row5').find('.crm-price-amount-amount')}
    private get additionalContribution400() {return cy.get('.contribution_amount-row6').find('.crm-price-amount-amount')}
    private  get additionalContributionNone() {return cy.get('.contribution_amount-row7')}
    private get otherAmountInput() {return cy.get('#price_131')}
    private get standartMembership() {return cy.get('.membership_amount-row1 > .price-set-option-content > label > .crm-price-amount-label')}
    private get threeYearsMembership() {return cy.get('.membership_amount-row2 > .price-set-option-content > label > .crm-price-amount-label')}
    private get continueButton() {return cy.get('#nextTab')}
    private max:number=6
    private min:number=1
    public chosenAdditionalContribution: number = 0;

    public chooseDollarOption(){
        var randomNumber:number = Math.floor(this.min + Math.random()*(this.max - this.min))
        console.log(randomNumber)
        const chooseOption: Record<number, ()=> void> = {
            1: ()  => {
                this.chosenAdditionalContribution = 10
                this.additionalContribution10.click()
            },
            2: () => {
                this.chosenAdditionalContribution = 25
                this.additionalContribution25.click()
            },
            3: () =>{
                this.chosenAdditionalContribution = 50
                this.additionalContribution50.click()
            },
            4: ()=> {
                this.chosenAdditionalContribution = 100
                this.additionalContribution100.click()
            },
            5: ()=> {
                this.chosenAdditionalContribution = 200
                this.additionalContribution200.click()
            },
            6: () => {
                this.chosenAdditionalContribution = 400
                this.additionalContribution400.click()
            }
        }
        chooseOption[randomNumber]?.()
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

    public continue() {
        this.continueButton.click()
    }
}

export const amountScreen: JoinPartyAmountScreen = new JoinPartyAmountScreen()