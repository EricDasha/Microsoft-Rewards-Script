FROM microsoft-rewards-script:official

COPY web-ui/server.js /opt/rewards-web/server.js
COPY web-ui/public /opt/rewards-web/public
COPY web-ui/start.sh /opt/rewards-web/start.sh
RUN chmod 755 /opt/rewards-web/start.sh \
    && mkdir -p /opt/rewards-web

EXPOSE 8080
CMD ["/opt/rewards-web/start.sh"]
