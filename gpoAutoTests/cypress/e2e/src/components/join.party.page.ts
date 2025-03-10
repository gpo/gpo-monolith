import { amountTab } from "./amount.tab.component"
import { billingTab } from "./billing.tab.component"
import { personalInfoTab } from "./personal.info.tab.component"

class JoinPartyPage {
    private get continueButton() { return cy.get('#nextTab') }
    public get amountTab() { return amountTab }
    public get billingTab() { return billingTab }
    public get personalInfoTab() { return personalInfoTab }
    public continue() {
        this.continueButton.click()
    }
}

export const joinPartyPage: JoinPartyPage = new JoinPartyPage()