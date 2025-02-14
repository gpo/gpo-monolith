class MainPage {

get footer() {return cy.get('aside[class="footer green-bg"]')}
get emailFieldFooter(){return this.footer.find('#sub_email')}
get postalCodeFooter(){return this.footer.find('#sub_postalcode')}
get joinButton() {return this.footer.find('button[type="submit"]')}
get logo() {return cy.get('img[alt="Green Party of Ontario Logo"]')}
get successfulSubscription() {return cy.contains('You have been subscribed to our newsletter')}
get becomeMemberMenuItem() {return cy.contains('Become a Member')}

public logoIsVisible() {
    this.logo.should("be.visible")
}

public becomeMemberClick() {
    this.becomeMemberMenuItem.click()
}

public enterEmail(email: string) {
    this.emailFieldFooter.type(email)
}

public enterPostalCode(postalCode: string) {
    this.postalCodeFooter.type(postalCode)
}

public join(email: string, postalCode: string) {
   this.footer.scrollIntoView()
    this.emailFieldFooter.type(email)
    this.postalCodeFooter.type(postalCode)
    this.joinButton.click()
}

public subscriptionSuccessful() {
    this.successfulSubscription.should('be.visible')
}
}

export const mainPage: MainPage = new MainPage()