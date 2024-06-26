# frozen_string_literal: true

require "open-uri"
require "nokogiri"
require "excon"

module Jobs
  class CrawlTopicLink < ::Jobs::Base
    sidekiq_options queue: "low"

    def execute(args)
      raise Discourse::InvalidParameters.new(:topic_link_id) if args[:topic_link_id].blank?

      topic_link = TopicLink.find_by(id: args[:topic_link_id], internal: false, crawled_at: nil)
      return if topic_link.blank?

      # Look for a topic embed for the URL. If it exists, use its title and don't crawl
      topic_embed =
        TopicEmbed.where(embed_url: topic_link.url).includes(:topic).references(:topic).first
      # topic could be deleted, so skip
      if topic_embed && topic_embed.topic
        TopicLink.where(id: topic_link.id).update_all(
          ["title = ?, crawled_at = CURRENT_TIMESTAMP", topic_embed.topic.title[0..255]],
        )
        return
      end

      begin
        crawled = false

        # Special case: Images
        # If the link is to an image, put the filename as the title
        if FileHelper.is_supported_image?(topic_link.url)
          uri = URI(topic_link.url)
          filename = File.basename(uri.path)
          crawled =
            (
              TopicLink.where(id: topic_link.id).update_all(
                ["title = ?, crawled_at = CURRENT_TIMESTAMP", filename],
              ) == 1
            )
        end

        unless crawled
          # Fetch the beginning of the document to find the title
          title = RetrieveTitle.crawl(topic_link.url)
          if title.present?
            crawled =
              (
                TopicLink.where(id: topic_link.id).update_all(
                  ["title = ?, crawled_at = CURRENT_TIMESTAMP", title[0..254]],
                ) == 1
              )
          end
        end
      rescue Exception
        # If there was a connection error, do nothing
      ensure
        if !crawled && topic_link.present?
          TopicLink.where(id: topic_link.id).update_all("crawled_at = CURRENT_TIMESTAMP")
        end
      end
    end
  end
end
