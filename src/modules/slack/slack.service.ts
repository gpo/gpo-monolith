import { Injectable } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackService {
  private slackClient: WebClient;

  constructor() {
    this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // Store in .env file
  }

  async sendMessage(channel: string, text: string): Promise<void> {
    try {
      await this.slackClient.chat.postMessage({ channel, text });
      console.log(`Message sent to ${channel}: ${text}`);
    } catch (error) {
      console.error('Slack API error:', error);
    }
  }
}
