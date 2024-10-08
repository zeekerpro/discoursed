import { action } from "@ember/object";
import Service, { service } from "@ember/service";
import {
  alertChannel,
  onNotification as onDesktopNotification,
} from "discourse/lib/desktop-notifications";
import { withPluginApi } from "discourse/lib/plugin-api";
import { isTesting } from "discourse-common/config/environment";
import { bind } from "discourse-common/utils/decorators";

export default class ChatNotificationManager extends Service {
  @service presence;
  @service chat;
  @service chatChannelsManager;
  @service chatStateManager;
  @service currentUser;
  @service appEvents;
  @service site;

  _subscribedToCore = true;
  _subscribedToChat = false;
  _countChatInDocTitle = true;

  start() {
    if (!this._shouldRun()) {
      return;
    }

    this.set(
      "_chatPresenceChannel",
      this.presence.getChannel(`/chat-user/chat/${this.currentUser.id}`)
    );
    this.set(
      "_corePresenceChannel",
      this.presence.getChannel(`/chat-user/core/${this.currentUser.id}`)
    );
    this._chatPresenceChannel.subscribe();
    this._corePresenceChannel.subscribe();

    withPluginApi("0.12.1", (api) => {
      api.onPageChange(this._pageChanged);
    });

    this._pageChanged();

    this._chatPresenceChannel.on(
      "change",
      this._subscribeToCorrectNotifications
    );
    this._corePresenceChannel.on(
      "change",
      this._subscribeToCorrectNotifications
    );
  }

  willDestroy() {
    super.willDestroy(...arguments);

    if (!this._shouldRun()) {
      return;
    }

    this._chatPresenceChannel.off(
      "change",
      this._subscribeToCorrectNotifications
    );
    this._chatPresenceChannel.unsubscribe();
    this._chatPresenceChannel.leave();

    this._corePresenceChannel.off(
      "change",
      this._subscribeToCorrectNotifications
    );
    this._corePresenceChannel.unsubscribe();
    this._corePresenceChannel.leave();
  }

  shouldCountChatInDocTitle() {
    return this._countChatInDocTitle;
  }

  @bind
  _pageChanged() {
    if (this.chatStateManager.isActive) {
      this._chatPresenceChannel.enter({ onlyWhileActive: false });
      this._corePresenceChannel.leave();
    } else {
      this._chatPresenceChannel.leave();
      this._corePresenceChannel.enter({ onlyWhileActive: false });
    }
  }

  _coreAlertChannel() {
    return alertChannel(this.currentUser);
  }

  _chatAlertChannel() {
    return `/chat${alertChannel(this.currentUser)}`;
  }

  @bind
  _subscribeToCorrectNotifications() {
    const oneTabForEachOpen =
      this._chatPresenceChannel.count > 0 &&
      this._corePresenceChannel.count > 0;
    if (oneTabForEachOpen) {
      this.chatStateManager.isActive
        ? this._subscribeToChat({ only: true })
        : this._subscribeToCore({ only: true });
    } else {
      this._subscribeToBoth();
    }
  }

  _subscribeToBoth() {
    this._subscribeToChat();
    this._subscribeToCore();
  }

  _subscribeToChat(opts = { only: false }) {
    this.set("_countChatInDocTitle", true);

    if (!this._subscribedToChat) {
      this.messageBus.subscribe(this._chatAlertChannel(), this.onMessage);
      this.set("_subscribedToChat", true);
    }

    if (opts.only && this._subscribedToCore) {
      this.messageBus.unsubscribe(this._coreAlertChannel(), this.onMessage);
      this.set("_subscribedToCore", false);
    }
  }

  _subscribeToCore(opts = { only: false }) {
    if (opts.only) {
      this.set("_countChatInDocTitle", false);
    }
    if (!this._subscribedToCore) {
      this.messageBus.subscribe(this._coreAlertChannel(), this.onMessage);
      this.set("_subscribedToCore", true);
    }

    if (opts.only && this._subscribedToChat) {
      this.messageBus.unsubscribe(this._chatAlertChannel(), this.onMessage);
      this.set("_subscribedToChat", false);
    }
  }

  @action
  async fetchChannel(channelId) {
    return await this.chatChannelsManager.find(channelId, {
      fetchIfNotFound: false,
    });
  }

  @bind
  async onMessage(data) {
    if (data.channel_id === this.chat.activeChannel?.id) {
      return;
    }

    if (this.site.desktopView) {
      const channel = await this.fetchChannel(data.channel_id);

      if (channel) {
        data.isDirectMessageChannel = channel.isDirectMessageChannel ?? false;
      }

      return onDesktopNotification(
        data,
        this.siteSettings,
        this.currentUser,
        this.appEvents
      );
    }
  }

  _shouldRun() {
    return this.chat.userCanChat && !isTesting();
  }
}
