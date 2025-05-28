import { amountTab } from "./amount.tab.component"
import { billingTab } from "./billing.tab.component"
import { personalInfoTab } from "./personal.info.tab.component"
import { personalInfo } from '../../testData/test.data'

class JoinPartyPage {
    private get continueButton() { return cy.get('#nextTab') }
    public get amountTab() { return amountTab }
    public get billingTab() { return billingTab }
    public get personalInfoTab() { return personalInfoTab }
    public continue() {
        this.continueButton.click()
    }

    public proceedToCardTab() {
        joinPartyPage.amountTab.chooseStandartMembership()
        joinPartyPage.continue()
        joinPartyPage.personalInfoTab.enterPersonalInfo(personalInfo);
        joinPartyPage.continue()
    }
}

export const joinPartyPage: JoinPartyPage = new JoinPartyPage()