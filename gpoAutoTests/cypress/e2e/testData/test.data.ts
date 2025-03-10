export interface Card {
    number: string;
    securityCode: string;
    expirationYear: string;
    expirationMonth: string;
    expectedExpirationDate: string;
}

export interface BillingInfo {
    personalInfo: PersonalInfo,
    country: string,
    state: string,
    expectedCountry: string,
    expectedState: string
}

export interface PersonalInfo {
    firstName: string;
    lastName: string;
    email: string;
    street: string;
    city: string;
    postalCode: string
}

export const personalInfo: PersonalInfo = {
    firstName: "John",
    lastName: "Test",
    email: "test@test.test",
    street: "unexisted 12",
    city: "Toronto",
    postalCode: "N2G0C8",
}

export const oneYearCard: Card = {
    number: "5111111111111118",
    securityCode: "234",
    expirationMonth: "Dec",
    expirationYear: "2028",
    expectedExpirationDate: "December 2028"
}

export const threeYearsCard: Card = {
    number: "4222222222222220",
    securityCode: "234",
    expirationMonth: "Dec",
    expirationYear: "2028",
    expectedExpirationDate: "December 2028"
}

export const billingInfo: BillingInfo = {
    personalInfo: {
        firstName: "billing john",
        lastName: "billing test",
        street: "billing street 12",
        city: "Waterloo",
        postalCode: "N3G0C6",
        email: ""
    },
    country: "Canada",
    expectedCountry: "CA",
    state: "Ontario",
    expectedState: "ON"
}

